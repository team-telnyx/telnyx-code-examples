---
name: sms-auto-reply-bot-nodejs
title: "SMS Auto-Reply Bot"
description: "Receive inbound SMS via signed Telnyx webhooks and send automatic replies using Node.js and Express."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Auto-Reply Bot

Receive inbound SMS via signed Telnyx webhooks and send automatic replies using Node.js and Express.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every inbound event is Ed25519-signed so you can verify it really came from Telnyx.
- **Developer-first** — first-class Node.js SDK, a consistent webhook event model, and pay-as-you-go pricing.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound Message Webhook**: `message.received` event delivered to your webhook URL — [Inbound message webhook reference](https://developers.telnyx.com/api-reference/messaging/webhooks)

## Architecture

```
  Inbound SMS
        │
        ▼
  ┌────────────────────┐
  │  Telnyx Messaging   │
  └─────────┬──────────┘
            │  POST message.received (signed)
            ▼
  ┌────────────────────┐
  │  /webhooks/sms      │
  │  1. verify signature │
  │  2. read data.payload│
  │  3. pick reply text  │
  └─────────┬──────────┘
            │  POST /v2/messages
            ▼
  ┌────────────────────┐
  │  Telnyx Messaging   │ ──► auto-reply delivered to sender
  └────────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used to send replies | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `5z3...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Messaging → Webhook signing](https://portal.telnyx.com) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number replies are sent from (E.164) | [Portal → Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `PORT` | `number` | `3000` | no | Port the Express server listens on (default `3000`) | — |
| `WEBHOOK_URL` | `string` | `https://abc.ngrok.io/webhooks/sms` | no | Public webhook URL, logged on startup for convenience | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:3000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 3000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Copy your **public key** from the Messaging Profile's webhook signing settings into `TELNYX_PUBLIC_KEY`. The webhook route rejects any request whose signature does not verify against this key.

## API Reference

### `POST /webhooks/sms`

Telnyx delivers inbound `message.received` events here. The route verifies the
Ed25519 signature before processing, then replies based on the message text:
messages containing `help` or `hours` get tailored answers; everything else gets
a default acknowledgement.

```bash
# Telnyx sends this automatically. Example payload shape:
curl -X POST http://localhost:3000/webhooks/sms \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": { "phone_number": "+12125551234" },
        "text": "What are your hours?"
      }
    }
  }'
```

**Response (signature valid, reply sent):**

```json
{
  "success": true,
  "message_id": "msg-f5d7a7e0-1234-5678"
}
```

**Response (invalid or missing signature):**

```json
{
  "error": "invalid signature"
}
```

### `POST /sms/send`

Send an SMS manually. Useful for testing without an inbound message.

```bash
curl -X POST http://localhost:3000/sms/send \
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

### `GET /health`

Liveness probe.

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok" }
```

## Troubleshooting

- **Every webhook returns 401 `invalid signature`**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the public key from your Messaging Profile's webhook signing settings into `.env` and restart the server. The raw request body must be preserved for verification — do not place another JSON parser in front of this route.
- **Connection refused on port 3000**: App isn't running, or another process holds the port. Run `node server.js` and check `PORT`.
- **401 `Authentication failed` when sending**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Reply not sending**: Confirm `TELNYX_PHONE_NUMBER` is set, is in E.164 format, and has messaging enabled with a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned.
- **Inbound SMS never hits the webhook**: Verify the Inbound Webhook URL in the Messaging Profile points at your public `/webhooks/sms` URL and that the profile is attached to the receiving number.

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single SMS via the Messaging API
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) — AI SMS chatbot with memory

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook Signing & Verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
