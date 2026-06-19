---
name: sms-conversation-threading
title: "SMS Conversation Threading"
description: "Group inbound and outbound SMS by contact into persistent conversation threads with the Telnyx Messaging API and a SQLAlchemy-backed store."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Conversation Threading

Group inbound and outbound SMS by contact into persistent conversation threads with the Telnyx Messaging API and a SQLAlchemy-backed store.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Two-way messaging built in** — send with `POST /v2/messages` and receive inbound SMS through a single signed webhook.
- **Deliverability included** — number reputation, 10DLC registration, and delivery receipts on every message.
- **Developer-first** — typed SDKs for Python, Node.js, Go, and Ruby, plus a consistent webhook event model.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Telnyx Webhook Events

This app handles these inbound webhook events ([Messaging docs](https://developers.telnyx.com/docs/messaging/messages/receiving-messages)):

- `message.received` — Inbound SMS/MMS received from a contact; stored against their conversation thread.

Every inbound webhook is signature-verified with the Telnyx Ed25519 public key before processing.

## Architecture

```
  Inbound SMS                      Outbound send (REST)
        │                                  │
        ▼                                  ▼
  ┌──────────────────┐            ┌──────────────────┐
  │ POST /webhooks/sms │           │ POST /conversations │
  │ • verify signature │           │      /<num>/send    │
  │ • parse payload    │           │ • Telnyx messages   │
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
            │ store_message()       │  ← SQLAlchemy: conversations + messages
            └──────────┬───────────┘
                       ▼
                GET /conversations
                GET /conversations/<id>
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_public_key` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Keys & Credentials](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number messages are sent from | [Portal → Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `DATABASE_URL` | `string` | `sqlite:///conversations.db` | no | SQLAlchemy connection URL (Postgres for production) | — |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-conversation-threading-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

The SQLite schema is created automatically on startup. To receive inbound SMS, expose the server publicly:

```bash
ngrok http 5000
```

Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

## API Reference

### `POST /conversations/<contact_number>/send`

Send an outbound SMS to a contact and append it to their conversation thread. `contact_number` is the E.164 destination in the URL path.

```bash
curl -X POST http://localhost:5000/conversations/+12125551234/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from Telnyx!"}'
```

**Response `201`:**

```json
{
  "id": "8f1c5e2a-3b4d-4f6a-9c8e-1d2f3a4b5c6d",
  "conversation_id": "b2c3d4e5-6f70-4819-a2b3-c4d5e6f70819",
  "direction": "outbound",
  "from": "+15551234567",
  "to": "+12125551234",
  "body": "Hello from Telnyx!",
  "status": "queued",
  "created_at": "2026-06-18T14:30:00.000000"
}
```

### `GET /conversations`

List all conversation threads, most recently active first.

```bash
curl http://localhost:5000/conversations
```

**Response `200`:**

```json
[
  {
    "id": "b2c3d4e5-6f70-4819-a2b3-c4d5e6f70819",
    "contact_number": "+12125551234",
    "message_count": 4,
    "last_message_at": "2026-06-18T14:30:00.000000",
    "created_at": "2026-06-18T14:00:00.000000"
  }
]
```

### `GET /conversations/<conversation_id>`

Retrieve a single thread with all of its messages in chronological order.

```bash
curl http://localhost:5000/conversations/b2c3d4e5-6f70-4819-a2b3-c4d5e6f70819
```

**Response `200`:**

```json
{
  "id": "b2c3d4e5-6f70-4819-a2b3-c4d5e6f70819",
  "contact_number": "+12125551234",
  "message_count": 2,
  "created_at": "2026-06-18T14:00:00.000000",
  "last_message_at": "2026-06-18T14:30:00.000000",
  "messages": [
    {
      "id": "8f1c5e2a-3b4d-4f6a-9c8e-1d2f3a4b5c6d",
      "direction": "inbound",
      "from": "+12125551234",
      "to": "+15551234567",
      "body": "Hi, is anyone there?",
      "status": "received",
      "created_at": "2026-06-18T14:29:00.000000"
    }
  ]
}
```

### `POST /webhooks/sms`

Receives Telnyx inbound messaging webhook events. Called automatically by Telnyx — do not call directly. The Ed25519 signature is verified before the body is parsed; an inbound `message.received` event is stored against the sender's conversation thread.

**Example payload:**

```json
{
  "data": {
    "event_type": "message.received",
    "id": "a1b2c3d4-5678-9abc-def0-123456789abc",
    "occurred_at": "2026-06-18T14:29:00.000Z",
    "payload": {
      "id": "msg-f5d7a7e0-1234-5678",
      "from": { "phone_number": "+12125551234" },
      "to": [ { "phone_number": "+15551234567" } ],
      "text": "Hi, is anyone there?"
    },
    "record_type": "event"
  }
}
```

**Response `200`:**

```json
{ "status": "stored" }
```

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

**Response `200`:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on the webhook | `TELNYX_PUBLIC_KEY` missing or mismatched | Copy the public key from [Portal → Keys & Credentials](https://portal.telnyx.com/api-keys) into `.env`. The key must belong to the same account that sends the webhooks. |
| `401 Invalid API key` when sending | `TELNYX_API_KEY` invalid | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys). |
| Webhook never fires | Local server not publicly reachable | Expose it with ngrok and set the Inbound Webhook URL on your Messaging Profile to `https://<id>.ngrok.io/webhooks/sms`. |
| `sqlite3.OperationalError: database is locked` | SQLite under concurrent writes | Move to Postgres for production: set `DATABASE_URL=postgresql://user:pass@host/db` and install `psycopg2-binary`. |
| `404 Conversation not found` | Wrong conversation ID | List threads with `GET /conversations` and copy the exact `id`. |

## Related Examples

- [Send SMS (Python)](../send-sms-python)
- [Receive SMS (Python)](../receive-sms-python)
- [SMS Chatbot with Conversation Memory (Python)](../sms-chatbot-with-conversation-memory-python)

## Resources

- [Receiving Messages Guide](https://developers.telnyx.com/docs/messaging/messages/receiving-messages)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook Signing](https://developers.telnyx.com/docs/messaging/messages/webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
