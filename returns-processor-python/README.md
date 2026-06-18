---
name: returns-processor
title: "Returns Processor"
description: "Customer texts photo of defective item via MMS, AI evaluates damage, auto-approves low-value refunds via Stripe, escalates high-value to team lead."
language: python
framework: flask
telnyx_products: [AI Inference]
integrations: [Stripe, Shopify, Slack]
channel: [sms]
---

# Returns Processor

Customer texts photo of defective item via MMS, AI evaluates damage, auto-approves low-value refunds via Stripe, escalates high-value to team lead.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## External Service Integrations

- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))
- **Stripe** — Payment processing ([docs](https://docs.stripe.com/api))

## Architecture

```
  Shopify Webhook
        │
        ▼
  ┌──────────────────┐
  │  Parse Message    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │  AI Inference     │
  │  • Escalation      │
  │  • Scoring         │
  └────────┬─────────┘
           │
           ├──► SMS to customer
           ├──► Slack notification
           ├──► Payment processing
```

## Telnyx Webhook Events

This app handles these [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `message.received` -- Inbound SMS/MMS received
- `message.sent` -- Outbound message accepted by carrier
- `message.finalized` -- Final delivery status

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `STRIPE_API_KEY` | `string` | `your_value` | **yes** | Stripe api key | — |
| `SHOPIFY_STORE` | `string` | `your_value` | **yes** | Shopify store | — |
| `SHOPIFY_ACCESS_TOKEN` | `string` | `your_value` | **yes** | Shopify access token | — |
| `SUPPORT_SLACK_WEBHOOK` | `string` | `your_value` | **yes** | Support slack webhook | — |
| `AUTO_REFUND_THRESHOLD` | `string` | `50` | no | Auto refund threshold | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/returns-processor-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

### Docker

```bash
docker build -t returns-processor-python .
docker run --env-file .env -p 5000:5000 returns-processor-python
```

## API Reference

### `GET /returns`

Returns returns

```bash
curl http://localhost:5000/returns
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /returns/<int:idx>/approve`

Triggers approve

```bash
curl -X POST http://localhost:5000/returns/<int:idx>/approve \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Webhook Endpoints

### `POST /webhooks/sms`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events.

**Example payload:**

```json
{
  "data": {
    "event_type": "message.received",
    "id": "f5d7a7e0-1234-5678-9abc-def012345678",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "id": "f5d7a7e0-1234-5678-9abc-def012345678",
      "direction": "inbound",
      "type": "SMS",
      "from": {
        "phone_number": "+12125551234",
        "carrier": "Verizon",
        "line_type": "Wireless"
      },
      "to": [{"phone_number": "+13105559876"}],
      "text": "Hello, I need help",
      "media": [],
      "received_at": "2026-07-15T14:30:00.000Z",
      "messaging_profile_id": "40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c"
    },
    "record_type": "event"
  }
}
```

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
