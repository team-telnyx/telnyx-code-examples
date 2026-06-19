# Build Two-Way Shortcode SMS with Telnyx

Send and receive two-way SMS over a Telnyx shortcode with Flask. This guide walks through outbound messaging from a shortcode, verified inbound webhooks, and delivery status handling.

## How It Works

```
  API Request                          Inbound SMS to shortcode
        │                                       │
        ▼                                       ▼
  POST /sms/send                        Telnyx Messaging
        │                                       │
        ▼                                       ▼  (signed webhook)
  Telnyx Messaging  ──► outbound SMS    POST /webhooks/sms
                                                │
                                                ▼
                                        verify signature → store message
```

## Telnyx Products Used

- **Messaging** — send and receive SMS over a shortcode with delivery receipts.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound webhooks**: `message.received` / `message.finalized` events delivered to your `/webhooks/sms` route.

## Prerequisites

- Python 3.8+ (3.12+ recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance.
- A [Telnyx API key](https://portal.telnyx.com/api-keys).
- Your account **public key** (used to verify webhook signatures), from the [Telnyx Portal](https://portal.telnyx.com/).
- A provisioned Telnyx **shortcode** with messaging enabled.
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL.
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/shortcode-sms-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your credentials:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_SHORTCODE=123456
WEBHOOK_URL=https://your-domain.com/webhooks/sms
FLASK_DEBUG=false
```

`TELNYX_PUBLIC_KEY` is required: every inbound webhook is signature-checked against it before the body is trusted.

## Step 2: Understand the Code

Everything lives in `app.py`. The Telnyx client is initialized once with both the API key (for outbound calls) and the public key (for verifying inbound webhooks):

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

### Sending from the shortcode

`send_shortcode_sms()` validates input, then calls the Messaging API with the shortcode as the `from_` address:

```python
response = client.messages.create(
    from_=TELNYX_SHORTCODE,
    to=to_number,
    text=message,
)
```

It returns only JSON-serializable fields — the raw SDK objects are not serializable.

### Receiving inbound SMS

The webhook route verifies the signature first, then parses the event. Telnyx nests event fields under `data.payload`, while `event_type` stays at the `data` level:

```python
@app.route("/webhooks/sms", methods=["POST"])
def handle_inbound_sms():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    body = request.get_json(silent=True)
    data = body.get("data", {})
    event_type = data.get("event_type")
    payload = data.get("payload", {})
    ...
```

`unwrap()` reads the `telnyx-signature-ed25519` and `telnyx-timestamp` headers and raises if the signature or replay-window check fails. Exceptions are logged server-side and never returned in responses.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send an SMS from the shortcode |
| `POST` | `/webhooks/sms` | Receive inbound + delivery webhooks (signature-verified) |
| `GET`  | `/messages/received` | List captured inbound messages |
| `GET`  | `/health` | Liveness probe |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL into the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send an outbound SMS:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from your Telnyx shortcode!"}'
```

**Receive an inbound SMS:** text your shortcode from a mobile phone. Telnyx posts a signed `message.received` event to `/webhooks/sms`, which is stored in memory:

```bash
curl http://localhost:5000/messages/received
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory list with PostgreSQL or Redis.
- **Webhook verification** — already enforced here via `client.webhooks.unwrap()`; keep `TELNYX_PUBLIC_KEY` in your secret store.
- **Authentication** — add API key validation on `/sms/send`.
- **Monitoring** — add structured logging and health-check alerts.
- **Rate limiting** — queue and throttle bulk sends to stay within Telnyx limits.

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
