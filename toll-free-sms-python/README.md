---
name: toll-free-sms
title: "Toll-Free SMS"
description: "Send SMS from a toll-free number with the Telnyx Messaging API and track delivery status via signed webhooks."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Toll-Free SMS

Send SMS from a toll-free number with the Telnyx Messaging API and track delivery status via signed webhooks.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Toll-free messaging built in** — verified toll-free numbers carry higher throughput and better deliverability for A2P traffic than long codes.
- **Delivery receipts** — every message emits signed status webhooks (`queued` → `sent` → `delivered`/`failed`) so you always know what happened.
- **Single API** — provision the number, attach a Messaging Profile, and send, all from the same platform.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

Inbound delivery status updates arrive on `POST /webhooks/message-status` (defined by this app, configured on your Messaging Profile).

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌──────────────────────┐
  │ Flask app (app.py)    │
  │  send_tollfree_sms()  │──► POST /v2/messages ──► Telnyx Messaging
  └──────────┬───────────┘                                │
             │ store message_id + status                  │ delivery receipt
             ▼                                             ▼
   message_status_store          POST /webhooks/message-status (signature-verified)
             ▲                                             │
             └─────────── update status (delivered/failed) ┘
```

The app keeps message metadata in an in-memory dict keyed by message ID. When Telnyx
posts a delivery receipt, the signed webhook updates that record. Swap the dict for a
database in production.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o5x...base64...` | **yes** | Public key used to verify inbound webhook signatures | [Portal](https://portal.telnyx.com/api-keys) (Public Key) |
| `TOLLFREE_NUMBER` | `string` | `+18885551234` | **yes** | Your toll-free sending number (E.164) | [Portal Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `MESSAGING_PROFILE_ID` | `string` | `40000000-0000-0000-0000-000000000000` | no | Messaging Profile to route through | [Portal Profiles](https://portal.telnyx.com/messaging/profiles) |
| `FLASK_ENV` | `string` | `development` | no | Set to `development` to enable Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/toll-free-sms-python
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

   - **Messaging Profile** → Outbound → Webhook URL → `https://<id>.ngrok.io/webhooks/message-status`

The app verifies the Telnyx Ed25519 signature on every inbound webhook using
`TELNYX_PUBLIC_KEY`, so the public key must be set for delivery receipts to be accepted.

## API Reference

### `GET /health`

Liveness probe.

```bash
curl http://localhost:5000/health
```

```json
{ "status": "healthy", "timestamp": "2026-06-18T12:00:00.000000" }
```

### `POST /sms/send`

Send a toll-free SMS.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Your verification code is 123456"
  }'
```

```json
{
  "message_id": "40000000-0000-0000-0000-000000000000",
  "status": "queued",
  "from": "+18885551234",
  "to": "+12125551234",
  "segments": 1,
  "created_at": "2026-06-18T12:00:00.000000"
}
```

### `GET /sms/status/<message_id>`

Return the cached delivery status for a message.

```bash
curl http://localhost:5000/sms/status/40000000-0000-0000-0000-000000000000
```

```json
{
  "id": "40000000-0000-0000-0000-000000000000",
  "from": "+18885551234",
  "to": "+12125551234",
  "status": "delivered",
  "segments": 1,
  "created_at": "2026-06-18T12:00:00.000000",
  "updated_at": "2026-06-18T12:00:03.000000"
}
```

### `GET /sms/messages`

List every message sent in this session.

```bash
curl http://localhost:5000/sms/messages
```

```json
{ "count": 1, "messages": [ { "id": "40000000-...", "status": "delivered" } ] }
```

### `POST /webhooks/message-status`

Telnyx-only. Receives delivery receipts. The signature is verified against
`TELNYX_PUBLIC_KEY` before the body is parsed; invalid signatures get `401`. You do not
call this endpoint yourself — Telnyx posts to it.

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40000000-0000-0000-0000-000000000000",
      "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
    }
  }
}
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Invalid API key**: `TELNYX_API_KEY` is wrong or has trailing whitespace. Regenerate at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Webhook returns 401 "invalid signature"**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the Public Key (not the API key) from the Portal, and make sure the request actually originates from Telnyx.
- **Status never updates past "queued"**: Your webhook URL is not publicly reachable. Use ngrok and set the URL on the Messaging Profile's outbound webhook.
- **Toll-free number not provisioned for SMS**: Confirm the number is enabled for outbound SMS in the Portal and is in E.164 format (e.g. `+18885551234`).
- **429 Rate limit exceeded**: Back off and retry; throttle bulk sends through a queue.

## Related Examples

- [send-sms-python](../send-sms-python/) - Send a single SMS from any Telnyx number
- [ai-compliance-quiz-phone-python](../ai-compliance-quiz-phone-python/) - Signed Telnyx voice webhooks with per-call state

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook signing](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
