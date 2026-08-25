# Webhook Aggregator Fanout — Developer Guide

This guide walks through the `webhook-aggregator-fanout` example, a Flask application that receives Telnyx webhooks, deduplicates them, logs them to a SQL database, and fans them out to action-specific queues for processing.

By the end of this guide, you'll understand:

- How the app verifies and ingests Telnyx webhooks
- How deduplication works with a TTL-based in-memory KV store
- How events are logged to SQLite
- How events are fanned out to call and SMS action queues
- How each action type is processed using the Telnyx SDK

---

## Prerequisites

Before running this example, you'll need:

- **Python 3.8+** installed
- **A Telnyx account** with:
  - An API key (`TELNYX_API_KEY`)
  - A public key for webhook signature verification (`TELNYX_PUBLIC_KEY`)
- **A Telnyx phone number** configured to send webhooks to your app
- **A public URL** (or local tunnel like `ngrok`) to receive webhooks

---

## Environment Setup

1. **Clone the repository and navigate to the sample:**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/webhook-aggregator-fanout
   ```

2. **Create a virtual environment and install dependencies:**

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**

   Copy `.env.example` to `.env` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   Your `.env` file should look like this:

   ```
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
   DB_PATH=webhook_events.db
   DEDUP_TTL_SECONDS=300
   PORT=5000
   ```

   | Variable | Description | Default |
   |----------|-------------|---------|
   | `TELNYX_API_KEY` | Your Telnyx API key (required) | — |
   | `TELNYX_PUBLIC_KEY` | Your Telnyx public key for webhook verification (required) | — |
   | `DB_PATH` | Path to the SQLite database file | `webhook_events.db` |
   | `DEDUP_TTL_SECONDS` | How long to remember events for deduplication (seconds) | `300` |
   | `PORT` | Port the Flask app listens on | `5000` |

4. **Configure your Telnyx webhook endpoint:**

   In the Telnyx Mission Control Portal, set your webhook URL to:

   ```
   https://your-public-url/webhooks
   ```

   Make sure your Telnyx number is configured to send call and SMS events to this endpoint.

---

## Running the App

Start the Flask server:

```bash
python app.py
```

You should see output similar to:

```
 * Running on http://0.0.0.0:5000
```

The app exposes several endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks` | POST | Receives Telnyx webhooks |
| `/health` | GET | Health check with queue status |
| `/events` | GET | Retrieve logged events from the database |
| `/queues` | GET | View current queue contents |

---

## How It Works

The app is structured around four core responsibilities:

1. **Webhook ingestion** — receive and verify incoming Telnyx events
2. **Deduplication** — prevent processing the same event twice
3. **Event logging** — persist every event to SQLite
4. **Fanout** — route events to call and SMS action queues

Let's walk through each piece.

---

### 1. Webhook Ingestion and Verification

The entry point is the `/webhooks` route. When Telnyx sends a webhook, the handler does the following:

1. **Verifies the signature** using the Telnyx SDK's `unwrap` method. This ensures the request genuinely came from Telnyx and hasn't been tampered with.

2. **Extracts the event data** — the event type and payload from the webhook body.

3. **Generates a unique event ID** — either using the event ID Telnyx provides, or by hashing the payload if no ID is present.

Here's the relevant code:

```python
# Verify webhook signature
event = telnyx.webhooks.unwrap(
    request.data,
    request.headers.get("X-Telnyx-Signature-Ed25519"),
    request.headers.get("X-Telnyx-Timestamp")
)

# Extract event data
event_type = event.get("data", {}).get("event_type", "")
payload = event.get("data", {}).get("payload", {})

# Generate event ID for deduplication
event_id = event.get("data", {}).get("id") or generate_event_id(payload)
```

**Why this matters:** Signature verification is critical. Without it, anyone could send fake webhooks to your endpoint and trigger actions. The Telnyx SDK handles the cryptographic verification for you — you just pass the raw request body and the signature headers.

---

### 2. Deduplication with TTL-Based KV Store

Webhooks can be delivered more than once (e.g., due to retries or network issues). To avoid processing the same event multiple times, the app uses an in-memory dictionary as a key-value store with a time-to-live (TTL).

The deduplication logic works like this:

1. **Check for expired entries** — any entry older than `DEDUP_TTL_SECONDS` is removed.
2. **Check if the event ID already exists** — if it does, it's a duplicate and the app returns a `duplicate` status without processing it.
3. **Store the event ID** with the current timestamp.

```python
def is_duplicate(event_id):
    current_time = time.time()

    # Clean up expired entries
    expired_keys = [k for k, (ts, _) in dedup.items() if current_time - ts > DEDUP_TTL_SECONDS]
    for key in expired_keys:
        del dedup[key]

    if event_id in dedup:
        app.logger.info(f"Duplicate event detected: {event_id}")
        return True

    # Store event with timestamp
    dedup[event_id] = (current_time, current_time)
    return False
```

**Why TTL?** The TTL ensures the dedup store doesn't grow unbounded. After 5 minutes (default), an event ID is forgotten, so if the same event arrives again later, it's treated as new. This is a trade-off: you get protection against immediate duplicates but don't hold memory forever.

**Production note:** This example uses an in-memory store, which works for a single instance. In production, you'd use a distributed store like Redis with the same TTL pattern.

---

### 3. Event Logging to SQLite

Every unique event is logged to a SQLite database. The `log_event` function inserts a row with:

- The event ID (unique constraint)
- The event type
- The full payload (as JSON)
- Timestamps for when the event was received and processed

The database schema is created on startup:

```python
cursor.execute("""
    CREATE TABLE IF NOT EXISTS webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE,
        event_type TEXT,
        payload TEXT,
        received_at TEXT,
        processed_at TEXT
    )
""")
```

**Why SQLite?** SQLite is a zero-configuration, file-based database that's perfect for examples and small deployments. The same pattern applies to PostgreSQL or MySQL — you'd just swap the connection logic.

The `/events` endpoint lets you query the last 100 logged events:

```bash
curl http://localhost:5000/events
```

---

### 4. Fanout to Action Queues

The fanout logic routes each event to a specific queue based on its event type:

- Events with `"call"` in the event type → **call queue**
- Events with `"message"` or `"sms"` in the event type → **sms queue**
- Everything else → logged but not queued

The queues are simple in-memory lists stored in a dictionary:

```python
action_queues = defaultdict(list)
ACTION_TYPES = ["call", "sms"]
```

The `enqueue_action` function validates the action type and appends the event to the appropriate queue:

```python
def enqueue_action(action_type, event_data):
    if action_type not in ACTION_TYPES:
        app.logger.warning(f"Unknown action type: {action_type}")
        return False

    action_queues[action_type].append(event_data)
    app.logger.info(f"Event queued for {action_type} action")
    return True
```

**Why fanout?** This pattern decouples webhook ingestion from action processing. In production, each queue would be backed by a message broker (like SQS, RabbitMQ, or Redis) and processed by separate workers. This example keeps it simple with in-memory queues and synchronous processing.

---

### 5. Processing Actions

After queuing, the app processes all queues synchronously. In production, this would be a separate worker process consuming from the queues.

#### Call Actions

The `process_call_action` function handles call events:

1. **Extracts the `call_control_id`** from the payload
2. **Answers the call** using Telnyx Call Control
3. **Plays a greeting audio** to the caller

```python
# Example: Answer the call
telnyx.CallControl.Answer(call_control_id=call_control_id)

# Example: Play a greeting
telnyx.CallControl.PlayAudio(
    call_control_id=call_control_id,
    audio_url="https://example.com/greeting.mp3"
)
```

**Telnyx Call Control** gives you real-time control over calls — you can answer, hang up, play audio, gather digits, and more. The `call_control_id` is a unique identifier for the active call.

#### SMS Actions

The `process_sms_action` function handles SMS events:

1. **Extracts the sender, recipient, and message text**
2. **Sends an auto-reply** using the Telnyx Messages API

```python
telnyx.Message.create(
    from_=to_number,  # Reply to the sender
    to=from_number,
    text=f"Thanks for your message! We received: {text[:50]}..."
)
```

**Telnyx SMS API** lets you send and receive SMS messages programmatically. The `Message.create` method sends a new message.

---

## Telnyx Primitives Used

| Primitive | Description | Where Used |
|-----------|-------------|------------|
| **Webhooks** | Real-time event notifications from Telnyx | `/webhooks` endpoint |
| **Signature Verification** | Ed25519 cryptographic verification of webhook authenticity | `telnyx.webhooks.unwrap` |
| **Call Control** | Real-time call management (answer, play audio, etc.) | `process_call_action` |
| **Messages API** | Send SMS messages | `process_sms_action` |
| **SQLite** | Persistent storage for event logging | `log_event`, `/events` endpoint |

---

## Running the Example End-to-End

1. **Start the app** (see Environment Setup above).

2. **Expose your local server** with ngrok:

   ```bash
   ngrok http 5000
   ```

   Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`).

3. **Configure your Telnyx webhook** in Mission Control to point to:

   ```
   https://abc123.ngrok.io/webhooks
   ```

4. **Trigger a test event** — make a call to your Telnyx number or send an SMS.

5. **Watch the logs** — you should see:

   ```
   Event logged to database
   Event queued for call action
   Answered call: ...
   Playing greeting for call: ...
   ```

6. **Check the event log**:

   ```bash
   curl http://localhost:5000/events
   ```

7. **Check queue status**:

   ```bash
   curl http://localhost:5000/queues
   ```

8. **Test deduplication** — send the same webhook twice (e.g., with a tool like Postman) and observe the second request returns `{"status": "duplicate"}`.

---

## Next Steps

Now that you understand how the webhook aggregator fanout pattern works, here are some ways to extend it:

- **Replace in-memory queues** with a distributed queue like Redis or SQS for horizontal scaling
- **Replace SQLite** with PostgreSQL for production-grade persistence
- **Add more action types** (e.g., fax, verify, or custom actions)
- **Process queues asynchronously** with a background worker (Celery, RQ, etc.)
- **Add retry logic** for failed API calls
- **Add metrics** for queue depth, processing time, and error rates

### Related Documentation

- [Telnyx Webhooks Overview](https://developers.telnyx.com/docs/v2/webhooks)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/call-control)
- [Messages API Reference](https://developers.telnyx.com/docs/api/v2/messages)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Webhook Security Guide](https://developers.telnyx.com/docs/v2/webhooks/security)

---

## Troubleshooting

**Webhooks not arriving?**

- Verify your webhook URL is publicly accessible (use ngrok to test locally)
- Check the Telnyx Portal for delivery logs
- Ensure your number is configured to send events

**Signature verification failing?**

- Confirm `TELNYX_PUBLIC_KEY` is set correctly
- Ensure you're passing the raw request body (not parsed JSON)

**Duplicate events still processing?**

- Check `DEDUP_TTL_SECONDS` — if it's too low, events may be forgotten before retries arrive
- Remember the dedup store is in-memory — restarting the app clears it

**Database errors?**

- Check `DB_PATH` is writable
- The app creates the database automatically on startup
