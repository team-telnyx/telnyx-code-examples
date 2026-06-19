# Send SMS with an Alphanumeric Sender ID using Telnyx

Brand your SMS messages with a company name (e.g. `ACME Corp`) instead of a phone number, using the Telnyx Messaging API and Flask.

## How It Works

```
  API Request (to, message, sender_id)
        │
        ▼
  ┌───────────────────────────┐
  │ Flask app                  │
  │  • validate sender ID      │
  │  • validate recipient      │
  │  • block +1 (US/CA)        │
  └────────────┬──────────────┘
               │ from_ = "ACME Corp"
               ▼
  ┌───────────────────────────┐
  │ Telnyx Messaging          │
  └────────────┬──────────────┘
               │
               └──► SMS delivered with branded sender ID
```

## Telnyx Products Used

- **Messaging** — send messages with a branded alphanumeric sender ID

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) configured for alphanumeric sending
- A recipient number in a region that allows alphanumeric sender IDs (not US/Canada)

> Alphanumeric sender IDs are **not supported for US/Canada (+1)** recipients. They are widely supported across the UK, EU, and many other regions — check Telnyx country coverage for your destination.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/alphanumeric-sender-id-sms-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials:

```
TELNYX_API_KEY=KEY...
TELNYX_MESSAGING_PROFILE_ID=40000000-0000-0000-0000-000000000000
ALPHANUMERIC_SENDER_ID=ACME Corp
FLASK_DEBUG=false
```

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Validation helpers

- **`validate_alphanumeric_sender_id(sender_id)`** — returns `True` only when the ID is 1–11 characters of letters, numbers, and spaces. This mirrors the carrier rules for alphanumeric sender IDs.
- **`validate_recipient_number(to_number)`** — returns `True` for E.164-shaped numbers (starts with `+`, at least 10 characters).

### Sending logic

`send_sms_with_alphanumeric_id(to_number, message, sender_id)` ties it together:

1. Falls back to the `ALPHANUMERIC_SENDER_ID` env var when `sender_id` is not provided.
2. Validates the sender ID format.
3. Validates the recipient number.
4. Rejects `+1` (US/Canada) recipients, which do not support alphanumeric IDs.
5. Calls `client.messages.create(from_=sender_id, to=..., text=..., messaging_profile_id=...)`.
6. Returns a JSON-serializable dict (SDK objects are not directly serializable).

```python
response = client.messages.create(
    from_=sender_id,
    to=to_number,
    text=message,
    messaging_profile_id=messaging_profile_id,
)
return {
    "message_id": response.data.id,
    "status": response.data.to[0].status if response.data.to else "unknown",
    "from": sender_id,
    "to": to_number,
    "direction": response.data.direction,
}
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send-alphanumeric` | Send an SMS with a branded sender ID |
| `POST` | `/sms/validate-sender-id` | Check a sender ID format without sending |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Validate a sender ID:**

```bash
curl -X POST http://localhost:5000/sms/validate-sender-id \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "ACME Corp"}'
```

**Send a branded SMS:**

```bash
curl -X POST http://localhost:5000/sms/send-alphanumeric \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+447700900123",
    "message": "Your ACME order has shipped.",
    "sender_id": "ACME Corp"
  }'
```

The recipient sees the message from `ACME Corp` rather than a phone number.

## Going to Production

- **Sender ID registration** — some countries require pre-registration of alphanumeric sender IDs with carriers; register before launch to avoid filtering.
- **Database** — replace any in-memory data with a persistent store.
- **Authentication** — add API key validation on your endpoints.
- **Monitoring** — add structured logging and health-check alerts.
- **Rate limiting** — protect your endpoints from abuse.
- **One-way limitation** — recipients cannot reply to alphanumeric sender IDs; provide an alternate contact channel.

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
