---
name: send-mms-picture-message
title: "Send MMS Picture Message (Node.js)"
description: "Send an MMS picture message with media attachments using the Telnyx Messaging API and a Node.js and Express endpoint."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [mms]
---

# Send MMS Picture Message (Node.js)

Send an MMS picture message with one or more media attachments using the Telnyx Messaging API and a Node.js and Express endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network — with deliverability built in (number reputation, 10DLC registration, and deliverability monitoring) and SDKs for every major language.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

Called from the code via `client.messages.send({ from, to, text, media_urls })`. Supplying `media_urls` promotes the message from SMS to MMS.

## Architecture

```
  POST /mms/send
        │
        ▼
  ┌──────────────────┐
  │ Express handler   │
  │ (validate input)  │
  └────────┬─────────┘
           │ client.messages.send({ media_urls })
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │
           └──► MMS (text + media) delivered
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164), MMS-enabled | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

## API Reference

### `POST /mms/send`

Send a single MMS message with media attachments. Expects a JSON body with `to`, `message`, and `media_urls` (an array of publicly accessible URLs).

```bash
curl -X POST http://localhost:5000/mms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Check this out!",
    "media_urls": ["https://example.com/image.jpg"]
  }'
```

**Response `200`:**

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234",
  "media_count": 1
}
```

**Response `400`** (missing `to`, `message`, or `media_urls`; `media_urls` not an array; or non-E.164 number):

```json
{
  "error": "Missing required fields: 'to', 'message', and 'media_urls'"
}
```

### `GET /health`

Liveness probe.

```bash
curl http://localhost:5000/health
```

**Response `200`:**

```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Invalid API key` (401) | `TELNYX_API_KEY` is wrong, expired, or has trailing whitespace/quotes. | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart `node server.js`. |
| `Invalid request parameters` (400) | The `to` value does not start with `+`, `TELNYX_PHONE_NUMBER` is unset, or `media_urls` is empty. | Use E.164 (`+` then country code and number, no spaces or dashes, e.g. `+12125551234`), set `TELNYX_PHONE_NUMBER` in `.env`, and include at least one media URL. |
| `Missing required fields: 'to', 'message', and 'media_urls'` (400) | One or more required body fields are absent. | Send all three fields. `media_urls` must be a JSON array, even for a single attachment: `"media_urls": ["https://example.com/image.jpg"]`. |
| `'media_urls' must be an array of URLs` (400) | `media_urls` was sent as a string instead of an array. | Wrap the URL(s) in a JSON array. |
| Telnyx error about unreachable media | A URL in `media_urls` is not publicly reachable or is not a valid media file. | Confirm each URL loads in a browser, uses HTTPS, returns a supported type (JPEG, PNG, GIF, MP4, etc.), and requires no authentication. |
| `Rate limit exceeded` (429) | Too many requests too quickly. | Back off and retry; batch or throttle sends. |
| `Network error connecting to Telnyx` (503) | Outbound connection to the Telnyx API failed. | Check connectivity/firewall and retry. |
| MMS accepted but never delivered | Number is not MMS-enabled or has no Messaging Profile. | Assign a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) and confirm the number supports MMS. |

## Related Examples

- [send-sms-nodejs](../send-sms-nodejs/) - Send a plain text SMS (no media)
- [send-bulk-sms-nodejs](../send-bulk-sms-nodejs/) - Send many messages in a batch
- [send-mms-picture-message-python](../send-mms-picture-message-python/) - Same example in Python
- [receive-sms-webhook-nodejs](../receive-sms-webhook-nodejs/) - Receive inbound SMS/MMS via webhook
- [sms-delivery-receipts-nodejs](../sms-delivery-receipts-nodejs/) - Track final delivery status

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
