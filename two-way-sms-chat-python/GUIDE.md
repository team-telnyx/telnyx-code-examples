# Build Two-Way SMS Chat with Python and Flask

Run interactive, stateful text conversations: a user texts your Telnyx number, your Flask app receives a signed webhook, generates a reply, and texts it back.

## How It Works

```
  User texts your number
            │
            ▼
  ┌────────────────────┐
  │  Telnyx Messaging   │  signs the webhook (Ed25519)
  └─────────┬──────────┘
            │  POST message.received
            ▼
  ┌────────────────────┐
  │  /webhooks/sms      │  verify signature → parse data.payload
  │  (Flask)            │  → process_inbound_message()
  └─────────┬──────────┘
            │  POST /v2/messages (reply)
            ▼
  ┌────────────────────┐
  │  Telnyx Messaging   │  ──► reply SMS to the user
  └────────────────────┘
```

## Telnyx Products Used

- **Messaging** — send and receive SMS through a single Messaging Profile, with signed inbound webhooks.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound webhook**: `message.received` — [Receive webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Prerequisites

- Python 3.8+ (3.12+ recommended)
- A [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- An [API key](https://portal.telnyx.com/api-keys) and the matching **public key** (same page)
- A [phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials:

```
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_PHONE_NUMBER=+15551234567
FLASK_DEBUG=false
```

The `TELNYX_PUBLIC_KEY` and `TELNYX_API_KEY` are both on the [API Keys](https://portal.telnyx.com/api-keys) page in the Portal.

## Step 2: Understand the Code

Everything lives in `app.py`. Three pieces matter.

### Verify the webhook signature first

Every inbound webhook is signed by Telnyx with Ed25519. The client is initialized with both the API key (to send replies) and the public key (to verify inbound events):

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

At the very top of the webhook route — before parsing the body — verify the signature against the raw request bytes. `unwrap()` reads the `telnyx-signature-ed25519` and `telnyx-timestamp` headers and raises if the signature or replay check fails:

```python
@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    ...
```

### Read event fields from `data.payload`

`event_type` lives at the `data` level; the message fields live under `data.payload`:

```python
event_type = webhook_data.get("data", {}).get("event_type")
if event_type != "message.received":
    return jsonify({"status": "acknowledged"}), 200

payload = webhook_data.get("data", {}).get("payload", {})
from_number = payload.get("from", {}).get("phone_number")
message_text = payload.get("text")
```

### Generate a reply and send it back

`process_inbound_message()` is a small keyword router (`hello`, `help`, `info`, `status`, `reset`, `stop`) that updates per-sender state and returns reply text. `send_sms()` then posts the reply via `client.messages.create(...)`.

```python
response_text = process_inbound_message(from_number, message_text)
send_result = send_sms(from_number, response_text)
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/sms` | Receive signed inbound SMS and reply |
| `POST` | `/sms/send` | Send an outbound SMS directly |
| `GET`  | `/conversations` | List in-memory conversation state (debug) |

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

- **Messaging → Messaging Profiles** → your profile → **Inbound Settings** → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

Then make sure your `TELNYX_PHONE_NUMBER` is assigned to that Messaging Profile.

## Step 4: Test It

Send an outbound message to confirm credentials work:

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

Now text your Telnyx number with `hello`. You should receive the welcome reply, and the conversation should appear at:

```bash
curl http://localhost:5000/conversations
```

> Note: posting to `/webhooks/sms` by hand returns `401 invalid signature` — that's expected. Only Telnyx (or a request you sign with the matching key) passes verification.

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the `conversations` dict with PostgreSQL or Redis so state survives restarts and scales across instances.
- **Keep signature verification on** — it's already enforced; never disable it.
- **Authentication** — add API-key validation on `/sms/send` and lock down `/conversations`.
- **Monitoring** — add structured logging and alert on webhook `401`/`500` rates.
- **Rate limiting** — protect your endpoints from abuse.

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive SMS Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Webhook Signing & Verification](https://developers.telnyx.com/docs/messaging/messages/webhook-signing)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
