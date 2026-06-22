---
name: send-sms
title: "Send SMS (Node.js)"
description: "Send an SMS message using the Telnyx Messaging API with a Node.js and Express endpoint."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS (Node.js)

Send an SMS message using the Telnyx Messaging API with a Node.js and Express endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network — with deliverability built in (number reputation, 10DLC registration, and deliverability monitoring) and SDKs for every major language.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

Called from the code via `client.messages.send({ from, to, text })`.

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌──────────────────┐
  │ Express handler   │
  │ (validate input)  │
  └────────┬─────────┘
           │ client.messages.send()
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │
           └──► SMS delivered
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

## API Reference

### `POST /sms/send`

Send a single SMS. Expects a JSON body with `to` and `message`.

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
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

**Response `400`** (missing `to` or `message`, or non-E.164 number):

```json
{
  "error": "Missing required fields: 'to' and 'message'"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Invalid API key` (401) | `TELNYX_API_KEY` is wrong, expired, or has trailing whitespace/quotes. | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart `node server.js`. |
| `Phone number must be in E.164 format` (400) | The `to` value does not start with `+`. | Use E.164: `+` then country code and number, no spaces or dashes, e.g. `+12125551234`. |
| `TELNYX_PHONE_NUMBER environment variable not set` (400) | `.env` is missing or not loaded. | Ensure `.env` sits next to `server.js`, is named exactly `.env`, and contains `TELNYX_PHONE_NUMBER`. |
| `Rate limit exceeded` (429) | Too many requests too quickly. | Back off and retry; batch or throttle sends. |
| `Network error connecting to Telnyx` (503) | Outbound connection to the Telnyx API failed. | Check connectivity/firewall and retry. |
| SMS accepted but never delivered | Number has no Messaging Profile or messaging is not enabled. | Assign a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) and confirm the number is messaging-enabled. |

## Related Examples

- [send-sms-python](../send-sms-python/) - Same example in Python
- [send-sms-go](../send-sms-go/) - Same example in Go
- [send-sms-ruby](../send-sms-ruby/) - Same example in Ruby
- [send-bulk-sms-nodejs](../send-bulk-sms-nodejs/) - Send many messages in a batch
- [receive-sms-webhook-nodejs](../receive-sms-webhook-nodejs/) - Receive inbound SMS via webhook
- [sms-two-factor-auth-nodejs](../sms-two-factor-auth-nodejs/) - SMS-based 2FA / OTP

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
