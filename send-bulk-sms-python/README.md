---
name: send-bulk-sms
title: "Production-ready Flask application for sending bulk SMS via Telnyx."
description: "SMS application. Built with Telnyx Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, SMS/MMS]
channel: [sms]
---

# Production-ready Flask application for sending bulk SMS via Telnyx.

SMS application. Built with Telnyx Migration, Number Porting, SMS/MMS.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ▼
     Email notification
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `your_value` | **yes** | Telnyx phone number | — |
| `BULK_SMS_RATE_LIMIT` | `string` | `10` | no | Bulk sms rate limit | — |
| `BULK_SMS_DELAY` | `string` | `0.1` | no | Bulk sms delay | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-python
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
docker build -t send-bulk-sms-python .
docker run --env-file .env -p 5000:5000 send-bulk-sms-python
```

## API Reference

### `POST /sms/bulk/send`

HTTP endpoint to send bulk SMS messages.

```bash
curl -X POST http://localhost:5000/sms/bulk/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response:**

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "to": "+12125551234",
  "segments": 1
}
```

### `GET /sms/bulk/status`

Health check endpoint for bulk SMS service.

```bash
curl http://localhost:5000/sms/bulk/status
```

**Response:**

```json
{
  "messages": [
    {
      "id": "msg-f5d7a7e0-1234-5678",
      "to": "+12125551234",
      "text": "Your appointment is confirmed for July 18 at 2:30 PM",
      "status": "delivered",
      "sent_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
