# Build SMS Conversation Threading with Telnyx

Group inbound and outbound SMS by contact into persistent conversation threads with the Telnyx Messaging API and a SQLAlchemy-backed store.

## How It Works

```
  Inbound SMS                      Outbound send (REST)
        │                                  │
        ▼                                  ▼
  ┌──────────────────┐            ┌──────────────────┐
  │ POST /webhooks/sms │           │ POST /conversations │
  │ • verify signature │           │      /<num>/send    │
  └────────┬─────────┘            └────────┬─────────┘
           │                               │
           └───────────┬───────────────────┘
                       ▼
            ┌──────────────────────┐
            │ get_or_create_        │
            │ conversation()        │  ← threads keyed by contact number
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │ store_message()       │  ← conversations + messages tables
            └──────────────────────┘
```

A conversation is keyed by the contact's phone number. Every message — inbound or outbound — is written to a `messages` table linked to that conversation, so the full back-and-forth is queryable as one thread.

## Telnyx Products Used

- **Messaging** — send messages and receive inbound SMS with delivery receipts.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Webhook Events

Telnyx delivers inbound SMS as signed webhook events. Each event carries `event_type` at the `data` level and the message fields nested under `data.payload`.

- `message.received` — Inbound SMS/MMS received; the app stores it against the sender's thread.

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys) and [public key](https://portal.telnyx.com/api-keys) (for webhook signature verification)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-conversation-threading-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. `TELNYX_PUBLIC_KEY` is required so the app can verify that inbound webhooks genuinely came from Telnyx.

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Data Model

Two SQLAlchemy tables back the threads. A `Conversation` is unique per contact number and tracks a running message count; each `Message` references its conversation and records direction, body, and status.

```python
class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, index=True)
    contact_number = Column(String, unique=True, index=True, nullable=False)
    last_message_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    message_count = Column(Integer, default=0)
```

### Helper Functions

- **`get_or_create_conversation(contact_number)`** — looks up the thread for a contact, creating one if it doesn't exist, and returns its ID.
- **`store_message(...)`** — writes a message row, bumps the conversation's count and `last_message_at`, and returns a JSON-serializable dict.
- **`send_message_to_contact(to_number, body)`** — validates the destination, sends via `client.messages.create(...)`, and stores the outbound message.

### The Telnyx Client

The client is initialized with both the API key (to send) and the public key (to verify inbound webhooks):

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

### Handling Inbound Webhooks

The webhook handler verifies the signature first, then reads `event_type` from the `data` level and the message fields from `data.payload`:

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

    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200

    from_number = (payload.get("from") or {}).get("phone_number")
    to_number = (payload.get("to") or [{}])[0].get("phone_number")
    conversation_id = get_or_create_conversation(from_number)
    store_message(conversation_id, "inbound", from_number, to_number,
                  payload.get("text", ""), "received", payload.get("id"))
    return jsonify({"status": "stored"}), 200
```

`unwrap()` reads the `telnyx-signature-ed25519` and `telnyx-timestamp` headers and raises if the signature is wrong or the timestamp is stale (replay protection). Anything that fails verification is rejected with `401` before the body is trusted.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/conversations/<contact_number>/send` | Send an outbound SMS and thread it |
| `GET`  | `/conversations` | List all conversation threads |
| `GET`  | `/conversations/<conversation_id>` | Get one thread with its messages |
| `POST` | `/webhooks/sms` | Telnyx inbound message webhook handler |
| `GET`  | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000` and creates the SQLite schema on first run.

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send a message into a thread:**

```bash
curl -X POST http://localhost:5000/conversations/+12125551234/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from Telnyx!"}'
```

**Reply by texting your Telnyx number**, then read the full thread back:

```bash
curl http://localhost:5000/conversations | python3 -m json.tool
curl http://localhost:5000/conversations/<conversation_id> | python3 -m json.tool
```

## Going to Production

This example ships with SQLite for simplicity. For production:

- **Database** — switch `DATABASE_URL` to PostgreSQL; SQLite locks under concurrent writes.
- **Webhook verification** — already enforced; keep `TELNYX_PUBLIC_KEY` current after any key rotation.
- **Idempotency** — `telnyx_message_id` is unique; use it to dedupe redelivered webhooks.
- **Authentication** — add API key validation on the send and read endpoints.
- **Monitoring** — add structured logging and health check alerts.
- **Rate limiting** — protect your endpoints from abuse.

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](./README.md)
- [Receiving Messages Guide](https://developers.telnyx.com/docs/messaging/messages/receiving-messages)
- [Webhook Signing](https://developers.telnyx.com/docs/messaging/messages/webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
