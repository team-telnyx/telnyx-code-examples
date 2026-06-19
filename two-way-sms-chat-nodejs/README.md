---
name: two-way-sms-chat
title: "Two-Way SMS Chat"
description: "Send and receive SMS messages with Telnyx using Node.js and Express, with signature-verified inbound webhooks and automatic replies."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# Two-Way SMS Chat

Send and receive SMS messages with Telnyx using Node.js and Express, with signature-verified inbound webhooks and automatic replies.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every inbound event is signed with your public key so you can reject spoofed traffic.
- **One SDK** — the same `telnyx` Node.js client handles outbound sends and inbound webhook verification.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound message webhook**: `message.received`, `message.sent`, `message.finalized` events delivered to your `/webhooks/sms` route — [Messaging webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Architecture

```
  POST /sms/send                         Inbound text from a phone
        │                                          │
        ▼                                          ▼
  ┌──────────────┐                        ┌──────────────────┐
  │  Express app  │ ── POST /v2/messages ─▶│ Telnyx Messaging  │
  │  (server.js)  │◀── message.received ───┤    (webhook)      │
  └──────┬───────┘   (signature verified)  └──────────────────┘
         │
         └──► auto-reply via POST /v2/messages
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used to send messages | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0V...base64...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → API Keys → Public Key](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Your Telnyx number in E.164 format (the `from` address) | [Portal → My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `WEBHOOK_URL` | `string` | `https://abc123.ngrok.io` | no | Public base URL, logged on startup for convenience | — |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (default `3000`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`
   - Make sure the messaging profile is assigned to your `TELNYX_PHONE_NUMBER`.

Inbound webhooks are signature-verified, so `TELNYX_PUBLIC_KEY` must be set or every webhook will be rejected with `401`.

## API Reference

### `POST /sms/send`

Send a single outbound SMS.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234",
  "direction": "outbound"
}
```

### `POST /webhooks/sms`

Receives Telnyx messaging events (`message.received`, `message.sent`, `message.finalized`). Called by Telnyx, not by you. The signature is verified against `TELNYX_PUBLIC_KEY`; on a `message.received` event the app sends an automatic reply.

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "from": { "phone_number": "+12125551234" },
      "to": [{ "phone_number": "+15551234567" }],
      "text": "Hi there",
      "received_at": "2026-06-18T12:00:00.000Z"
    }
  }
}
```

**Response `200`:**

```json
{ "success": true, "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6" }
```

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

```json
{ "status": "ok" }
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `node server.js` and check no other process uses the port set in `PORT`.
- **401 `Invalid API key` on `/sms/send`**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **401 `invalid signature` on `/webhooks/sms`**: `TELNYX_PUBLIC_KEY` is missing or wrong, or a proxy mutated the request body. Copy the public key from the Portal and ensure no middleware rewrites the raw body before verification.
- **Webhook never fires**: Confirm the Messaging Profile webhook URL points at `/webhooks/sms` over HTTPS and that the profile is assigned to your number.
- **SMS not sending**: Check the number has messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned, and that `to` is E.164 (`+` prefix).

## Related Examples

- [send-sms-python](../send-sms-python/) — minimal one-way SMS send
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) — AI SMS chatbot with memory

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive inbound message webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/signature-verification)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
