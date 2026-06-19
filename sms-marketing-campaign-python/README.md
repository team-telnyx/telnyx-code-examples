---
name: sms-marketing-campaign
title: "SMS Marketing Campaign"
description: "Run bulk SMS marketing campaigns with Flask and the Telnyx Messaging API — create campaigns, send rate-limited batches, and track delivery via webhooks."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Marketing Campaign

Run bulk SMS marketing campaigns with Flask and the Telnyx Messaging API — create campaigns, send rate-limited batches, and track delivery via signed webhooks.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC brand/campaign registration, and deliverability monitoring are included, which matters for high-volume marketing sends.
- **Throughput control** — per-number and per-profile message rate limits let you scale bulk campaigns predictably.
- **Signed webhooks** — every delivery receipt is Ed25519-signed so your status tracking can trust the source.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — sends each campaign message. [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Outbound Message Delivery Receipts** (inbound webhook to your app) — Telnyx posts `message.sent` / `message.finalized` events with per-recipient delivery status. [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)

## Architecture

```
  POST /campaigns            POST /campaigns/{id}/send
        │                              │
        ▼                              ▼
  ┌──────────────┐            ┌─────────────────────┐
  │ campaigns DB  │            │ rate-limited batch   │──► POST /v2/messages ──► Telnyx
  │ (SQLite)      │◄───────────│ loop (RATE_LIMIT)    │
  └──────────────┘            └─────────────────────┘
        ▲                                                     │
        │                                                     ▼
        │                              Telnyx delivery receipt (Ed25519-signed)
        │                                                     │
        └──────────── POST /webhooks/message-status ◄─────────┘
                      (signature verified, status persisted)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used to send messages | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `eXaMpLe...base64` | **yes** | Public key used to verify inbound webhook signatures | [Portal → API Keys → Public Key](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number (E.164) used as the campaign sender | [Portal → My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-marketing-campaign-python
cp .env.example .env       # ← fill in your credentials
pip install -r requirements.txt
python app.py              # starts on http://localhost:5000
```

The SQLite schema (`marketing.db`) is created automatically on first run.

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Outbound → Delivery Receipt / Webhook URL → `https://<id>.ngrok.io/webhooks/message-status`

Inbound webhooks are rejected with `401` unless they carry a valid Telnyx Ed25519 signature, so `TELNYX_PUBLIC_KEY` must be set.

## API Reference

### `POST /campaigns`

Create a campaign and queue its recipients.

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Spring Sale",
    "message": "Spring sale! 20% off everything this weekend. Reply STOP to opt out.",
    "recipients": ["+12125551234", "+13105556789"]
  }'
```

**Response `201`:**

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "name": "Spring Sale",
  "recipient_count": 2,
  "status": "queued"
}
```

### `POST /campaigns/{campaign_id}/send`

Send a rate-limited batch of queued messages for the campaign.

```bash
curl -X POST http://localhost:5000/campaigns/f5d7a7e0-1234-5678-9abc-def012345678/send \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 100}'
```

**Response `200`:**

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "sent": 2,
  "failed": 0,
  "remaining": 0
}
```

### `GET /campaigns/{campaign_id}`

Get campaign status and a per-status recipient breakdown.

```bash
curl http://localhost:5000/campaigns/f5d7a7e0-1234-5678-9abc-def012345678
```

**Response `200`:**

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "name": "Spring Sale",
  "status": "sent",
  "created_at": "2026-06-18 12:00:00",
  "total_recipients": 2,
  "breakdown": { "delivered": 2 }
}
```

### `POST /webhooks/message-status`

Receives Telnyx delivery receipts. The Ed25519 signature is verified before processing; unsigned or tampered requests get `401`. Telnyx posts a single event object:

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

**Response `200`:** `{ "status": "received" }`

### `GET /health`

```bash
curl http://localhost:5000/health
```

**Response `200`:** `{ "status": "healthy" }`

## Troubleshooting

- **401 on the webhook**: The request signature failed verification. Confirm `TELNYX_PUBLIC_KEY` matches the public key in your [Portal](https://portal.telnyx.com/api-keys) and that the URL configured in Telnyx points exactly at `/webhooks/message-status`.
- **401 when sending**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Recipients silently skipped**: Numbers must be E.164 (`+` country code, digits only). `validate_phone_number()` drops anything else at campaign-creation time.
- **429 Rate limit exceeded**: Increase `RATE_LIMIT_DELAY` in `app.py` (e.g. `0.2`) or lower `batch_size`. Check your rate-limit tier in the [Portal](https://portal.telnyx.com).
- **"database is locked"**: SQLite has limited concurrency. Run a single Flask process for high volume, or migrate to PostgreSQL.
- **Delivery status never updates**: The webhook isn't reaching you. Verify the ngrok URL is live and set on the Messaging Profile.

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single SMS, the building block this campaign sender batches.
- [sms-chatbot-with-conversation-memory-python](../sms-chatbot-with-conversation-memory-python/) — handle inbound SMS replies with an AI chatbot.

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Receive Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
