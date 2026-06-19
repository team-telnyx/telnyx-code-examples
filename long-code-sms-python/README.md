---
name: long-code-sms
title: "Long Code SMS"
description: "Send A2P SMS over a long code with a rate-limited queue, delivery tracking, and signed inbound webhooks using the Telnyx Messaging API."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Long Code SMS

Send A2P SMS over a long code with a rate-limited queue, delivery tracking, and signed inbound webhooks using the Telnyx Messaging API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every inbound event is Ed25519-signed so you can verify it came from Telnyx before acting on it.
- **One API, one network** — outbound sends and inbound delivery receipts traverse the Telnyx-owned IP network for lower latency and higher reliability.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

Inbound `message.received` and `message.finalized` (delivery receipt) events are delivered to this app's `/webhooks/message` route by your Telnyx Messaging Profile.

## Architecture

```
  POST /sms/send          POST /sms/queue ──► in-memory queue
        │                                            │
        │                          POST /sms/queue/process
        │                                            │
        ▼                                            ▼
  ┌──────────────────────────────────────────────────────┐
  │              client.messages.create()                 │
  │                 Telnyx Messaging                      │
  └───────────────────────────┬──────────────────────────┘
                              │
            message.finalized │ message.received
                              ▼
                  POST /webhooks/message  (signature verified)
                              │
                              ▼
                  message_status (delivery tracking)
                  GET /sms/status/<message_id>
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key for sending messages | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `e5f6...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_LONG_CODE` | `string` | `+15551234567` | **yes** | Your Telnyx long code (E.164) used as the `from` number | [Portal → My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhooks/message` | **yes** | Public URL Telnyx posts inbound events to | Your deployment / ngrok |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-code-sms-python
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

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/message`

3. Set the same URL as `WEBHOOK_URL` in your `.env`.

The `/webhooks/message` route verifies the Telnyx Ed25519 signature on every request using `TELNYX_PUBLIC_KEY`. Requests with a missing or invalid signature are rejected with `401`.

## API Reference

### `POST /sms/send`

Send a single SMS immediately (bypasses the queue).

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from a Telnyx long code!"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40385fa2-1234-5678-9abc-def012345678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /sms/queue`

Queue an SMS for later batch sending. Enforces a per-recipient rate limit of 1 message/second.

```bash
curl -X POST http://localhost:5000/sms/queue \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Queued message",
    "metadata": {"campaign": "welcome"}
  }'
```

**Response `202`:**

```json
{
  "queued": true,
  "position": 1
}
```

### `POST /sms/queue/process`

Drain the queue and send every message via the Messaging API.

```bash
curl -X POST http://localhost:5000/sms/queue/process
```

**Response `200`:**

```json
{
  "processed": 1,
  "failed": 0,
  "results": [
    {
      "message_id": "40385fa2-1234-5678-9abc-def012345678",
      "status": "queued",
      "from": "+15551234567",
      "to": "+12125551234"
    }
  ]
}
```

### `GET /sms/status/<message_id>`

Retrieve the tracked delivery status for a message.

```bash
curl http://localhost:5000/sms/status/40385fa2-1234-5678-9abc-def012345678
```

**Response `200`:**

```json
{
  "status": "delivered",
  "direction": "outbound",
  "to": "+12125551234",
  "timestamp": "2026-06-18T12:00:00.000000"
}
```

### `POST /webhooks/message`

Receives inbound SMS (`message.received`) and delivery receipts (`message.finalized`) from Telnyx. The Ed25519 signature is verified before the body is parsed. Configure this URL in your Messaging Profile — you do not call it yourself.

**Response `200`:**

```json
{
  "status": "received"
}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

**Response `200`:**

```json
{
  "status": "healthy",
  "queue_size": 0,
  "tracked_messages": 0
}
```

## Troubleshooting

- **401 invalid signature on `/webhooks/message`**: The request failed Ed25519 verification. Confirm `TELNYX_PUBLIC_KEY` matches the public key in [Portal → API Keys](https://portal.telnyx.com/api-keys) and that the Messaging Profile is posting to the exact `/webhooks/message` URL.
- **401 Invalid API key on `/sms/send`**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **400 Invalid request / Phone number must be in E.164 format**: All numbers must start with `+` and use country code + number, no spaces or dashes (e.g. `+12125551234`).
- **Rate limit exceeded on `/sms/queue`**: The queue enforces 1 message/second per recipient. Space out requests or adjust `RATE_LIMIT_PER_SECOND` in `app.py`.
- **Status stuck at "sent" / `/sms/status` returns 404**: Delivery receipts arrive via webhook. Ensure `WEBHOOK_URL` is publicly reachable and configured on the Messaging Profile.

## Related Examples

- [send-sms-python](../send-sms-python/) — minimal single-message send.
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) — AI SMS chatbot.

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
