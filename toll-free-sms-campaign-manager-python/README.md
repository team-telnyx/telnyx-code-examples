---
name: toll-free-sms-campaign-manager
title: "Toll-Free SMS Campaign Manager"
description: "Toll-Free SMS Campaign Manager — manage toll-free verification and send compliant campaigns."
language: python
framework: flask
telnyx_products: [SMS/MMS]
channel: [sms]
---

# Toll-Free SMS Campaign Manager

Toll-Free SMS Campaign Manager — manage toll-free verification and send compliant campaigns.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **List Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Telnyx Webhook Events

This app handles these webhook events ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):

- `message.received` — Inbound SMS/MMS received

## Architecture

```
  Inbound SMS
        │
        ▼
  ┌──────────────────┐
  │  Messaging API    │
  └────────┬─────────┘
           │
           ├──► Escalation
           ├──► Campaign logic
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TOLL_FREE_NUMBER` | `string` | `your_value` | **yes** | Toll free number | — |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/toll-free-sms-campaign-manager-python
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
docker build -t toll-free-sms-campaign-manager-python .
docker run --env-file .env -p 5000:5000 toll-free-sms-campaign-manager-python
```

## API Reference

### `POST /campaigns`

Triggers campaigns

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer Outreach",
    "recipients": ["+12125551234", "+13105559876"],
    "message": "Your appointment reminder for tomorrow at 2 PM"
  }'
```

**Response:**

```json
{
  "campaign_id": "camp-1750280400",
  "status": "created",
  "recipients": 150,
  "scheduled_at": "2026-07-15T09:00:00Z"
}
```

### `POST /campaigns/<cid>/send`

Triggers send

```bash
curl -X POST http://localhost:5000/campaigns/example-id/send \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer Outreach",
    "recipients": ["+12125551234", "+13105559876"],
    "message": "Your appointment reminder for tomorrow at 2 PM"
  }'
```

**Response:**

```json
{
  "campaign_id": "camp-1750280400",
  "status": "created",
  "recipients": 150,
  "scheduled_at": "2026-07-15T09:00:00Z"
}
```

### `GET /verification/status`

Returns status

```bash
curl http://localhost:5000/verification/status
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

### `POST /webhooks/messaging`

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
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
