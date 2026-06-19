# Send Toll-Free SMS with Telnyx

Send SMS from a toll-free number with the Telnyx Messaging API and track delivery status
via signed webhooks. Toll-free numbers (888, 877, 866, 855, 844, 833) are purpose-built
for application-to-person (A2P) traffic: higher throughput and better deliverability than
long codes, with no per-campaign 10DLC registration.

## How It Works

```
  POST /sms/send
        │
        ▼
  ┌──────────────────────┐
  │ Flask app (app.py)    │
  │  send_tollfree_sms()  │──► POST /v2/messages ──► Telnyx Messaging
  └──────────┬───────────┘                                │
             │ store message_id + status                  │ delivery receipt
             ▼                                             ▼
   message_status_store          POST /webhooks/message-status (signature-verified)
             ▲                                             │
             └─────────── update status (delivered/failed) ┘
```

## Telnyx Products Used

- **Messaging** — send SMS from a toll-free number and receive signed delivery receipts.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Prerequisites

- Python 3.8+
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- A [Telnyx API key](https://portal.telnyx.com/api-keys) **and** the matching **Public Key** (both on the same page)
- A provisioned [toll-free number](https://portal.telnyx.com/numbers/my-numbers) enabled for outbound SMS
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an outbound webhook URL
- [ngrok](https://ngrok.com) (or similar) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/toll-free-sms-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TOLLFREE_NUMBER=+18885551234
MESSAGING_PROFILE_ID=your_messaging_profile_id_here   # optional
```

Both `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` come from the same
[API Keys](https://portal.telnyx.com/api-keys) page in the Portal. The public key is what
the app uses to verify that inbound webhooks genuinely came from Telnyx.

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Initializing the client with webhook verification

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

Passing `public_key` lets the SDK verify the Ed25519 signature on every inbound webhook.

### Sending the message

`send_tollfree_sms()` validates the destination number, estimates the segment count, and
calls `client.messages.create()` with the toll-free number as `from_`. It stores a record
keyed by message ID so later webhooks can update the delivery status:

```python
response = client.messages.create(
    from_=tollfree_number,
    to=to_number,
    text=message,
    # messaging_profile_id is added when MESSAGING_PROFILE_ID is set
)
message_id = response.data.id
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/health` | Liveness probe |
| `POST` | `/sms/send` | Send a toll-free SMS |
| `GET`  | `/sms/status/<message_id>` | Cached delivery status for one message |
| `GET`  | `/sms/messages` | List all messages sent this session |
| `POST` | `/webhooks/message-status` | Telnyx delivery receipts (signature-verified) |

### Verifying the webhook signature

The webhook handler verifies the signature against the raw body **before** parsing
anything. An invalid or missing signature returns `401`:

```python
@app.route("/webhooks/message-status", methods=["POST"])
def webhook_message_status():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    ...
```

After verification, the handler reads event fields from `data.payload` (the event type
stays at the `data` level) and updates the stored record:

```python
data = body.get("data", {})
event_type = data.get("event_type")
payload = data.get("payload", {})
message_id = payload.get("id")
recipients = payload.get("to") or []
status = recipients[0].get("status", "unknown") if recipients else "unknown"
```

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`.

In a separate terminal, expose it so Telnyx can reach your webhook:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Outbound → Webhook URL → `https://<id>.ngrok.io/webhooks/message-status`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send an SMS:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Your verification code is 123456"
  }'
```

The response includes a `message_id`. Once Telnyx posts the delivery receipt to your
webhook, check the updated status:

```bash
curl http://localhost:5000/sms/status/<message_id>
```

## Going to Production

This example uses an in-memory dict for simplicity. For production:

- **Database** — replace `message_status_store` with PostgreSQL or Redis so status survives restarts and scales horizontally.
- **Webhook verification** — already enforced via `client.webhooks.unwrap()`; keep `TELNYX_PUBLIC_KEY` set in every environment.
- **Authentication** — add API key or token validation on `/sms/send` and the read endpoints.
- **Rate limiting** — throttle outbound sends through a queue (Redis, RabbitMQ) and add exponential backoff on `429`.
- **Monitoring** — add structured logging and alert on `failed` delivery events.

## Resources

- [Source code and endpoint reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Webhook signing](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
