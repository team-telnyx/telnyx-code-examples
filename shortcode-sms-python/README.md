---
name: shortcode-sms
title: "Shortcode SMS"
description: "Send and receive two-way SMS over a Telnyx shortcode with Flask. Includes inbound webhook handling with signature verification."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Shortcode SMS

Send and receive two-way SMS over a Telnyx shortcode with Flask. Includes inbound webhook handling with signature verification.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Shortcodes built for scale** — high-throughput A2P messaging with carrier-grade deliverability and number reputation included.
- **Two-way messaging** — inbound and outbound SMS on the same shortcode, delivered to your webhook with signed payloads.
- **Developer-first** — typed SDKs, a consistent webhook event model, and a sandbox for testing.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound / delivery webhooks**: `message.received` and `message.finalized` events delivered to your `/webhooks/sms` route — [Inbound message webhook reference](https://developers.telnyx.com/api-reference/messaging/inbound-message-webhook)

## Architecture

```
  API Request                          Inbound SMS to shortcode
        │                                       │
        ▼                                       ▼
  POST /sms/send                        Telnyx Messaging
        │                                       │
        ▼                                       ▼  (signed webhook)
  Telnyx Messaging  ──► outbound SMS    POST /webhooks/sms
                                                │
                                                ▼
                                        verify signature → store message
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `e5q8...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Account → Public Key](https://portal.telnyx.com/) |
| `TELNYX_SHORTCODE` | `string` | `123456` | **yes** | Provisioned Telnyx shortcode used as the `from` address | [Portal → Messaging](https://portal.telnyx.com/messaging) |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhooks/sms` | no | Public URL Telnyx posts inbound events to (reference only) | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/shortcode-sms-python
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

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

Inbound webhooks are signature-verified with `TELNYX_PUBLIC_KEY`, so make sure that value matches the public key shown in your Telnyx account.

## API Reference

### `POST /sms/send`

Send an SMS from your shortcode.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from your Telnyx shortcode!"
  }'
```

**Response:**

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "123456",
  "to": "+12125551234",
  "segments": 1
}
```

### `POST /webhooks/sms`

Receives inbound `message.received` and delivery `message.finalized` events from Telnyx. The request signature is verified before the body is parsed; an invalid or missing signature returns `401`.

**Inbound event (sent by Telnyx):**

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "msg-inbound-abc123",
      "from": { "phone_number": "+12125551234" },
      "to": [{ "phone_number": "123456" }],
      "text": "HELP",
      "direction": "inbound",
      "received_at": "2026-06-18T12:00:00Z"
    }
  }
}
```

**Response:**

```json
{ "status": "received" }
```

### `GET /messages/received`

Return all inbound messages captured in memory.

```bash
curl http://localhost:5000/messages/received
```

**Response:**

```json
[
  {
    "id": "msg-inbound-abc123",
    "from": "+12125551234",
    "to": "123456",
    "text": "HELP",
    "received_at": "2026-06-18T12:00:00Z",
    "direction": "inbound"
  }
]
```

### `GET /health`

Liveness probe.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{ "status": "healthy", "timestamp": "2026-06-18T12:00:00.000000" }
```

## Troubleshooting

- **`401 invalid signature` on `/webhooks/sms`**: The Ed25519 signature check failed. Confirm `TELNYX_PUBLIC_KEY` matches the public key in your Telnyx account and that the request actually came from Telnyx. Signature verification covers the raw request body, so do not modify the payload upstream (no proxies that re-serialize JSON).
- **`401 Invalid API key` on `/sms/send`**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **`TELNYX_SHORTCODE environment variable not set`**: Add `TELNYX_SHORTCODE` to your `.env` file and restart the server.
- **Webhook never fires**: Verify the Inbound Webhook URL on your Messaging Profile points at your public `/webhooks/sms` URL and is reachable over HTTPS (`curl https://<id>.ngrok.io/health`). If using ngrok, the URL changes on each restart — update the portal accordingly.
- **Messages show `failed`/`undelivered`**: Confirm the destination number is valid E.164 (e.g. `+15551234567`), the shortcode is active, and it is registered for the destination country.

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single SMS from a long-code number.
- [receive-sms-python](../receive-sms-python/) — inbound SMS webhook handling.

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
