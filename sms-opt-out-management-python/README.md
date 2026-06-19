---
name: sms-opt-out-management
title: "SMS Opt-Out Management"
description: "Manage SMS opt-out preferences with Telnyx. Auto-handles STOP/UNSUBSCRIBE replies via verified inbound webhooks, blocks messages to opted-out numbers, and keeps an auditable opt-out list in SQLite."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Opt-Out Management

Manage SMS opt-out preferences with Telnyx. Auto-handles STOP/UNSUBSCRIBE replies via verified inbound webhooks, blocks messages to opted-out numbers, and keeps an auditable opt-out list in SQLite.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Inbound Message webhook**: `message.received` event delivered to your webhook URL -- [Webhook reference](https://developers.telnyx.com/api-reference/messaging/receive-inbound-message)

## Architecture

```
  Inbound "STOP" SMS                  Outbound send request
        │                                     │
        ▼                                     ▼
  ┌─────────────────────┐            ┌──────────────────────┐
  │ POST /webhooks/sms  │            │ POST /sms/send       │
  │ verify signature    │            │ check opt-out list   │
  └─────────┬───────────┘            └──────────┬───────────┘
            │                                   │
            ▼                                   ▼
  ┌─────────────────────┐            opted out? ──► 400 (blocked)
  │ add to opt-out list │                   │
  │ (SQLite optouts)    │                   ▼
  └─────────────────────┘            POST /v2/messages ──► Telnyx
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Compliance built in** — Telnyx auto-handles carrier-level STOP/HELP keywords, and this example layers your own auditable opt-out store on top so you stay TCPA/CTIA compliant.
- **Deliverability** — number reputation, 10DLC registration, and deliverability monitoring are included.
- **Signed webhooks** — every inbound event is Ed25519-signed so you can verify it really came from Telnyx.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_public_key` | **yes** | Public key used to verify inbound webhook signatures | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Your Telnyx phone number (E.164) | [Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `DB_PATH` | `string` | `optout.db` | no | SQLite database file path (default `optout.db`) | — |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-opt-out-management-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

The SQLite schema is created automatically on startup.

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

The `/webhooks/sms` route rejects any request whose Telnyx signature does not verify, so a valid `TELNYX_PUBLIC_KEY` is required for inbound STOP handling to work.

## API Reference

### `POST /sms/send`

Send an SMS. The recipient's opt-out status is checked first; opted-out numbers are rejected before any message is sent.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response:**

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /optout/add`

Manually add a number to the opt-out list.

```bash
curl -X POST http://localhost:5000/optout/add \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234", "reason": "customer request"}'
```

**Response:**

```json
{ "phone_number": "+12125551234", "status": "opted_out" }
```

### `POST /optout/remove`

Remove a number from the opt-out list (re-opt-in).

```bash
curl -X POST http://localhost:5000/optout/remove \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

**Response:**

```json
{ "phone_number": "+12125551234", "status": "opted_in" }
```

### `GET /optout/list`

List every opted-out number.

```bash
curl http://localhost:5000/optout/list
```

**Response:**

```json
{
  "optouts": [
    {
      "phone_number": "+12125551234",
      "opted_out_at": "2026-06-18 12:00:00",
      "reason": "User replied with: STOP",
      "source": "webhook"
    }
  ],
  "count": 1
}
```

### `POST /optout/check`

Check whether a single number is opted out.

```bash
curl -X POST http://localhost:5000/optout/check \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

**Response:**

```json
{ "phone_number": "+12125551234", "opted_out": true }
```

### `POST /webhooks/sms`

Inbound SMS webhook from Telnyx. The Ed25519 signature is verified before parsing; on a `message.received` event whose text is `STOP`, `STOPALL`, `UNSUBSCRIBE`, or `QUIT`, the sender is added to the opt-out list. Configure this URL on your Messaging Profile — you do not call it yourself.

**Response (opt-out keyword received):**

```json
{ "status": "opted_out", "phone_number": "+12125551234" }
```

## Troubleshooting

- **401 invalid signature on `/webhooks/sms`**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the public key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env`. The key must match the account that sends the webhooks.
- **401 Unauthorized from `/sms/send`**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Messages sent to opted-out numbers**: Numbers must match exactly, including the `+` and country code. Inspect the store with `sqlite3 optout.db "SELECT * FROM optouts;"`.
- **Webhook not firing**: Confirm the Messaging Profile inbound webhook URL is public (ngrok, not localhost) and that inbound SMS is enabled on the number.
- **`database is locked`**: SQLite has limited concurrent-write support. Run a single worker, or migrate to PostgreSQL for production.

## Related Examples

- [send-sms-python](../send-sms-python/) - Send a single SMS
- [two-way-sms-chat-python](../two-way-sms-chat-python/) - Inbound + outbound SMS conversations
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) - AI SMS chatbot

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Receive Inbound Messages](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook Signature Verification](https://developers.telnyx.com/docs/messaging/messages/webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
