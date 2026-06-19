---
name: send-sms-notifications
title: "Send SMS Notifications"
description: "Production-ready Flask service that sends SMS notifications, tracks delivery status via webhooks, and exposes a small REST API."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS Notifications

Production-ready Flask service that sends SMS notifications, tracks delivery status via signed Telnyx webhooks, and exposes a small REST API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every delivery-status callback is Ed25519-signed, so you can verify it really came from Telnyx before acting on it.
- **One API across channels** — start with SMS notifications, add voice or AI later without changing vendors.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — sends an outbound SMS. [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound delivery webhooks** — Telnyx posts `message.sent` and `message.finalized` events to your `/api/webhooks/sms` route. [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Architecture

```
  POST /api/notifications/send
        │
        ▼
  ┌──────────────────────┐        POST /v2/messages
  │  Flask notification   │ ───────────────────────────►  ┌───────────────┐
  │  service (app.py)     │                                │ Telnyx        │
  │  in-memory store      │ ◄─────────────────────────────│ Messaging     │
  └──────────┬───────────┘     signed delivery webhook     └───────────────┘
             │                 POST /api/webhooks/sms
             ▼
   status: pending → sent → delivered / failed
```

The service stores each notification in an in-memory dictionary keyed by an
auto-incrementing id. When Telnyx posts a delivery-status webhook, the handler
verifies the signature, matches the event to a stored notification by Telnyx
`message_id`, and updates its status.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `abc123...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Account → Keys & Credentials](https://portal.telnyx.com) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [Portal → Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `WEBHOOK_URL` | `string` | `https://abc.ngrok.io/api/webhooks/sms` | no | Public URL Telnyx posts delivery events to | — |
| `FLASK_ENV` | `string` | `development` | no | Flask environment | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-python
cp .env.example .env          # ← fill in your credentials
pip install -r requirements.txt
python app.py                 # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Outbound → Webhook URL → `https://<id>.ngrok.io/api/webhooks/sms`

3. Copy your **Public Key** from **Account → Keys & Credentials** into `TELNYX_PUBLIC_KEY`. The webhook route rejects any request whose Ed25519 signature does not verify against this key.

## API Reference

### `POST /api/notifications/send`

Send an SMS notification and create a tracking record.

```bash
curl -X POST http://localhost:5000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "+12125551234",
    "message": "Your order #12345 has shipped",
    "notification_type": "order_update"
  }'
```

**Response `201`:**

```json
{
  "notification_id": 1,
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "recipient": "+12125551234",
  "status": "sent",
  "notification_type": "order_update"
}
```

### `GET /api/notifications/<notification_id>`

Fetch a single notification's current status.

```bash
curl http://localhost:5000/api/notifications/1
```

**Response `200`:**

```json
{
  "id": 1,
  "recipient": "+12125551234",
  "message": "Your order #12345 has shipped",
  "notification_type": "order_update",
  "status": "delivered",
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "retry_count": 0,
  "created_at": "2026-06-18T12:00:00",
  "updated_at": "2026-06-18T12:00:05"
}
```

### `GET /api/notifications`

List notifications, newest first. Optional `status` and `limit` query params.

```bash
curl "http://localhost:5000/api/notifications?status=delivered&limit=10"
```

**Response `200`:**

```json
{
  "count": 1,
  "notifications": [
    {
      "id": 1,
      "recipient": "+12125551234",
      "status": "delivered",
      "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6"
    }
  ]
}
```

### `POST /api/webhooks/sms`

Receives Telnyx delivery-status events. The request body is **signature-verified**
before processing; an invalid or missing signature returns `401`. `event_type`
is read from `data.event_type`; message fields are read from `data.payload`.

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
    }
  }
}
```

**Response `200`:**

```json
{ "status": "processed" }
```

## Troubleshooting

- **`401 invalid signature` on the webhook**: `TELNYX_PUBLIC_KEY` is missing or wrong, or the raw body was altered by a proxy. Copy the Public Key from the Portal exactly and ensure nothing rewrites the request body before Flask reads it.
- **`401 Invalid API key` on send**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **`Phone number must be in E.164 format`**: Numbers must start with `+` and country code, no spaces or dashes — e.g. `+12125551234`.
- **Status never moves past `sent`**: Telnyx can't reach your webhook. Confirm the ngrok URL is set on the Messaging Profile and points at `/api/webhooks/sms`.
- **`429 Rate limit exceeded`**: You're sending faster than your plan allows. Throttle sends or queue them.

## Related Examples

- [send-sms-python](../send-sms-python/) — minimal single-message send.
- [sms-delivery-receipts-python](../sms-delivery-receipts-python/) — focused on delivery-receipt webhooks.
- [receive-sms-webhook-python](../receive-sms-webhook-python/) — handling inbound messages.

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Receive Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
