# Build a Long Code SMS Service with Telnyx

Send A2P (application-to-person) SMS over a long code — a standard 10-digit phone number — with a rate-limited send queue, delivery tracking, and signed inbound webhooks. This guide walks through the Flask application end to end.

## How It Works

```
  POST /sms/send          POST /sms/queue ──► in-memory queue
        │                                            │
        │                          POST /sms/queue/process
        │                                            │
        ▼                                            ▼
  ┌──────────────────────────────────────────────────────┐
  │              client.messages.create()                 │
  │                 Telnyx Messaging                      │
  └───────────────────────────┬──────────────────────────┘
                              │
            message.finalized │ message.received
                              ▼
                  POST /webhooks/message  (signature verified)
                              │
                              ▼
                  message_status (delivery tracking)
```

## Telnyx Products Used

- **Messaging** — send SMS over a long code and receive delivery receipts and inbound replies.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Prerequisites

- Python 3.8 or higher (3.12+ recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance.
- A [Telnyx API key](https://portal.telnyx.com/api-keys) and its matching **public key** (same page).
- A [long code](https://portal.telnyx.com/numbers/my-numbers) (10-digit US number) enabled for SMS, assigned to a [Messaging Profile](https://portal.telnyx.com/messaging/profiles).
- [ngrok](https://ngrok.com) (or any public URL) to receive webhooks locally.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-code-sms-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your credentials:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_LONG_CODE=+15551234567
WEBHOOK_URL=https://your-domain.com/webhooks/message
```

`TELNYX_PUBLIC_KEY` is required: the app uses it to verify the signature on every inbound webhook.

## Step 2: Understand the Code

Everything lives in `app.py`. The pieces:

### Client initialization

The SDK client is created with both the API key (for sending) and the public key (for verifying webhooks):

```python
client = telnyx.Telnyx(
    api_key=Config.TELNYX_API_KEY,
    public_key=Config.TELNYX_PUBLIC_KEY,
)
```

### Sending a message

`send_sms_endpoint()` and `send_queued_message()` both call the Messaging API:

```python
response = client.messages.create(
    from_=Config.TELNYX_LONG_CODE,
    to=to_number,
    text=message,
)
```

### Rate-limited queue

`is_rate_limited()` enforces one message per second per recipient — carriers throttle long codes, so spacing sends out protects deliverability. `queue_message()` validates E.164 format, checks the queue cap, and appends the message. `process_queue()` drains the queue, reporting per-message success and failure.

### Verified webhooks

`/webhooks/message` is the only route Telnyx calls. It verifies the Ed25519 signature on the raw request body **before** parsing anything:

```python
try:
    client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
except Exception:
    return jsonify({"error": "invalid signature"}), 401
```

After verification, event fields are read from `data.payload` (Telnyx nests them there), while `event_type` lives at the `data` level:

```python
event = data.get("data", {})
event_type = event.get("event_type")
payload = event.get("payload", {})
message_id = payload.get("id")
```

`message.received` records an inbound reply; `message.finalized` updates the tracked delivery status, queryable via `GET /sms/status/<message_id>`.

### All endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send one SMS immediately |
| `POST` | `/sms/queue` | Queue a message (rate-limited) |
| `POST` | `/sms/queue/process` | Drain and send the queue |
| `GET` | `/sms/status/<message_id>` | Look up delivery status |
| `POST` | `/webhooks/message` | Receive signed inbound + delivery events |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`. In another terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL into the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/message`

Set the same URL as `WEBHOOK_URL` in `.env`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send a message:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from a Telnyx long code!"}'
```

**Queue then process:**

```bash
curl -X POST http://localhost:5000/sms/queue \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Queued message"}'

curl -X POST http://localhost:5000/sms/queue/process
```

**Check status** (use the `message_id` from the send response):

```bash
curl http://localhost:5000/sms/status/<message_id>
```

Text your long code to see a `message.received` webhook arrive, then watch the delivery receipt flip the status to `delivered`.

## Going to Production

This example uses in-memory storage for the queue and status tracking. For production:

- **Persistent queue** — replace the in-memory list with a real broker (Redis, SQS) and a background worker instead of an on-demand `/sms/queue/process` call.
- **Database** — persist `message_status` in PostgreSQL so status survives restarts.
- **Keep signature verification on** — never disable the `client.webhooks.unwrap()` check.
- **10DLC registration** — register your brand and campaign so US carriers accept your long code A2P traffic.
- **Monitoring** — add structured logging and alert on `failed` counts from queue processing.

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Telnyx Portal](https://portal.telnyx.com)
