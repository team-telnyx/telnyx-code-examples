---
name: two-way-sms-chat
title: "Two-Way SMS Chat"
description: "Send and receive SMS with Telnyx to run interactive, stateful text conversations over a Flask webhook."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Two-Way SMS Chat

Send and receive SMS with Telnyx to run interactive, stateful text conversations over a Flask webhook.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Two-way messaging built in** — send and receive SMS through a single Messaging Profile, with inbound delivered to your webhook in real time.
- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every inbound event is signed with Ed25519 so you can verify it came from Telnyx before acting on it.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — sends the outbound reply. [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound Message webhook**: `message.received` — Telnyx delivers inbound SMS to your `/webhooks/sms` route. [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Architecture

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

Conversation state is held in an in-memory dict keyed by the sender's phone number. Replace it with a database for production (see [GUIDE.md](./GUIDE.md)).

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used to send replies | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `MFkwEwYH...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Your Telnyx number (E.164) that sends/receives messages | [Portal → My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging → Messaging Profiles** → your profile → **Inbound Settings** → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Assign your `TELNYX_PHONE_NUMBER` to that Messaging Profile so inbound SMS is routed to the webhook.

## API Reference

### `POST /webhooks/sms`

Receives signed `message.received` events from Telnyx. The signature is verified before the body is parsed; an invalid or missing signature returns `401`. On a valid inbound message the route generates a reply and sends it back to the user.

```bash
# Telnyx calls this — example shape of the event it POSTs:
curl -X POST http://localhost:5000/webhooks/sms \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <unix-ts>" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": { "phone_number": "+12125551234" },
        "to": [ { "phone_number": "+15551234567" } ],
        "text": "hello"
      }
    }
  }'
```

**Response:**

```json
{
  "status": "processed",
  "inbound_message": "hello",
  "response_sent": "Hello! Welcome to Telnyx SMS. Type 'help' for available commands or 'info' to learn more about our services.",
  "message_id": "msg-f5d7a7e0-1234-5678"
}
```

### `POST /sms/send`

Send an outbound SMS directly (not part of the inbound flow). Useful for testing your number and credentials.

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
  "to": "+12125551234",
  "text": "Hello from Telnyx!"
}
```

### `GET /conversations`

List active in-memory conversations (debugging only).

```bash
curl http://localhost:5000/conversations
```

**Response:**

```json
[
  {
    "phone_number": "+12125551234",
    "state": "greeted",
    "message_count": 2,
    "created_at": "2026-06-18T12:00:00"
  }
]
```

See [API.md](./API.md) for the full typed endpoint reference.

## Troubleshooting

- **`401 invalid signature` on `/webhooks/sms`**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the public key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart. The key must belong to the same account that sends the webhooks.
- **Webhooks never arrive**: Confirm the Messaging Profile's Inbound Webhook URL points at `https://<id>.ngrok.io/webhooks/sms` and that your `TELNYX_PHONE_NUMBER` is assigned to that profile. Verify ngrok is still running and the URL hasn't rotated.
- **Replies not delivered**: Check the server logs for the `send_sms()` path. Make sure `TELNYX_PHONE_NUMBER` is E.164 and is messaging-enabled on the same profile.
- **`401 Invalid API key` on `/sms/send`**: `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single outbound SMS
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) — AI-powered SMS chatbot with memory

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive SMS Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook Signing & Verification](https://developers.telnyx.com/docs/messaging/messages/webhook-signing)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
