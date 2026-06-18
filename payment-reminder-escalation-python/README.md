---
name: payment-reminder-escalation
title: "Payment Reminder Escalation"
description: "Invoice overdue: day 1 SMS, day 7 voice call with payment link, day 14 escalation to collections with full context. Integrates with Stripe/QuickBooks."
language: python
framework: flask
telnyx_products: [Voice]
integrations: [Stripe, Slack]
channel: [voice]
---

# Payment Reminder Escalation

Invoice overdue: day 1 SMS, day 7 voice call with payment link, day 14 escalation to collections with full context. Integrates with Stripe/QuickBooks.

## Telnyx API Endpoints Used

- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction

## External Service Integrations

- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))
- **Stripe** — Payment processing ([docs](https://docs.stripe.com/api))

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► TTS (Text-to-Speech)
         ├──► Messaging API
         ├──► Number Porting
         │
         ▼
    SMS to customer
    Slack notification

  External: Stripe
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `COLLECTIONS_SLACK_WEBHOOK` | `string` | `your_value` | **yes** | Collections slack webhook | — |
| `STRIPE_API_KEY` | `string` | `your_value` | **yes** | Stripe api key | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/payment-reminder-escalation-python
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

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t payment-reminder-escalation-python .
docker run --env-file .env -p 5000:5000 payment-reminder-escalation-python
```

## API Reference

### `POST /invoices`

Triggers invoices

```bash
curl -X POST http://localhost:5000/invoices \
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

### `POST /reminders/run`

Triggers run

```bash
curl -X POST http://localhost:5000/reminders/run \
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

### `GET /invoices`

Returns invoices

```bash
curl http://localhost:5000/invoices
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

### `POST /invoices/<int:idx>/paid`

Triggers paid

```bash
curl -X POST http://localhost:5000/invoices/<int:idx>/paid \
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

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`

**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      "call_session_id": "428c31b6-abcd-1234-5678-5013ef9657c1",
      "client_state": null,
      "from": "+12125551234",
      "to": "+13105559876",
      "direction": "incoming",
      "state": "ringing"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
