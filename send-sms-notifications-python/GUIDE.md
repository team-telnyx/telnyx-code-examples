# Build an SMS Notification Service with Telnyx

Send SMS notifications from a small Flask service, track each one through to
delivery using signed Telnyx webhooks, and expose a REST API to send and query
notifications.

## How It Works

```
  POST /api/notifications/send
        │
        ▼
  ┌──────────────────────┐        POST /v2/messages
  │  Flask notification   │ ───────────────────────────►  ┌───────────────┐
  │  service (app.py)     │                                │ Telnyx        │
  │  in-memory store      │ ◄─────────────────────────────│ Messaging     │
  └──────────┬───────────┘     signed delivery webhook     └───────────────┘
             │                 POST /api/webhooks/sms
             ▼
   status: pending → sent → delivered / failed
```

## Telnyx Products Used

- **Messaging** — send SMS and receive delivery-status webhooks.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Delivery webhooks**: `message.sent`, `message.finalized` — [webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Prerequisites

- Python 3.8+ (3.12 recommended)
- A [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- A [Telnyx API key](https://portal.telnyx.com/api-keys)
- Your **Public Key** from **Account → Keys & Credentials** (used to verify webhooks)
- A [Telnyx phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an outbound webhook URL
- [ngrok](https://ngrok.com) to expose your local server to Telnyx

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and `TELNYX_PHONE_NUMBER`.

## Step 2: Understand the Code

Everything lives in `app.py`. There are three layers.

### The notification model

A `Notification` object tracks a single message through its lifecycle. Status
moves through `pending → sent → delivered` (or `failed`). Records are kept in an
in-memory `notifications_db` dictionary — swap this for a database in production.

### The send service

`send_notification()` validates the recipient is E.164, sends via the Telnyx
client, stores the record, and returns a JSON-serializable summary:

```python
response = client.messages.create(
    from_=from_number,
    to=recipient,
    text=message,
)
notification.message_id = response.data.id
notification.status = NotificationStatus.SENT.value
```

The Telnyx client is created once at module load with both your API key and your
public key:

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

The public key is what lets the SDK verify inbound webhook signatures.

### The routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/notifications/send` | Send a notification |
| `GET`  | `/api/notifications/{id}` | Get one notification's status |
| `GET`  | `/api/notifications` | List notifications |
| `POST` | `/api/webhooks/sms` | Receive Telnyx delivery events |
| `GET`  | `/health` | Liveness probe |

### The webhook handler

This is the most important part to get right. Before trusting anything, verify
the signature against the **raw** request body:

```python
@bp.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    data = request.get_json(silent=True)
    event = data.get("data", {})
    event_type = event.get("event_type")   # event_type lives at the data level
    payload = event.get("payload", {})      # event fields are nested under data.payload
    message_id = payload.get("id")
    ...
```

Two details matter:

1. **`unwrap()` runs first.** It reads the `telnyx-signature-ed25519` and
   `telnyx-timestamp` headers and raises if the signature or replay-timestamp
   check fails. A failed check returns `401` and nothing else runs.
2. **Field nesting.** `event_type` is read from `data.event_type`, while the
   message id and per-recipient delivery status come from `data.payload`.

On `message.finalized`, the handler reads `payload["to"][0]["status"]` to decide
whether the message was `delivered` or `failed`, then updates the stored record.

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`. In a second terminal, expose it:

```bash
ngrok http 5000
```

Copy the HTTPS URL into the [Telnyx Portal](https://portal.telnyx.com) under your
Messaging Profile's outbound webhook URL, appending `/api/webhooks/sms`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send a notification:**

```bash
curl -X POST http://localhost:5000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"recipient": "+12125551234", "message": "Your order shipped", "notification_type": "order_update"}'
```

You'll get back a `notification_id`. Watch it move from `sent` to `delivered` as
Telnyx posts webhooks:

```bash
curl http://localhost:5000/api/notifications/1
```

> Note: because webhooks are signature-verified, you cannot simulate them with a
> plain `curl` — they must come from Telnyx (or be signed with your key). Use a
> real message to a real number to see the status transition.

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace `notifications_db` with PostgreSQL or Redis.
- **Authentication** — add API key validation on the send/list endpoints.
- **Webhook verification** — already enforced here via `client.webhooks.unwrap()`. Keep `TELNYX_PUBLIC_KEY` set.
- **Monitoring** — structured logging and health-check alerting.
- **Rate limiting / queueing** — for bulk sends, throttle with a message queue.

## Resources

- [Source code and API reference](./README.md)
- [Endpoint reference](./API.md)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Receive webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
