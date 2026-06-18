---
name: sms-two-factor-auth
title: "Production-ready OTP 2FA system with Flask and Telnyx SMS."
description: "SMS application. Built with Telnyx Cloud Storage, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [Cloud Storage, Migration, Number Porting, SMS/MMS, Verify]
---

# Production-ready OTP 2FA system with Flask and Telnyx SMS.

SMS application. Built with Telnyx Cloud Storage, Migration, Number Porting, SMS/MMS.

## Telnyx API Endpoints Used

- **Send Message (OTP)**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  API Request
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Verify API
         ├──► Number Porting
         ├──► DTMF Input
         │
         ▼
    Email notification

  State: Database + Redis cache
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `OTP_EXPIRY_SECONDS` | `string` | `300` | no | Otp expiry seconds | — |
| `TELNYX_PHONE_NUMBER` | `string` | `your_value` | **yes** | Telnyx phone number | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t sms-two-factor-auth-python .
docker run --env-file .env -p 5000:5000 sms-two-factor-auth-python
```

## API Reference

### `POST /auth/request-otp`

Request an OTP to be sent to the provided phone number.

```bash
curl -X POST http://localhost:5000/auth/request-otp \
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

### `POST /auth/verify-otp`

Verify the OTP code provided by the user.

```bash
curl -X POST http://localhost:5000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125551234",
    "channel": "sms"
  }'
```

**Response:**

```json
{
  "verification_id": "ver-abc123",
  "status": "pending",
  "channel": "sms",
  "phone": "+12125551234"
}
```

### `GET /auth/otp-status`

Get OTP status for a phone number (for testing/debugging only).

```bash
curl http://localhost:5000/auth/otp-status
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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
