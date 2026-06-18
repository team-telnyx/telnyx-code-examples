---
name: sms-two-factor-auth
title: "Production-ready OTP 2FA system with Flask and Telnyx SMS."
description: "SMS application. Built with Telnyx Cloud Storage, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [Cloud Storage, Migration, Number Porting, SMS/MMS, Verify]
---

# Production-ready OTP 2FA system with Flask and Telnyx SMS.

Production-ready OTP 2FA system with Flask and Telnyx SMS.


## Telnyx API Endpoints Used

- **Messaging**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)


## Architecture

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `OTP_EXPIRY_SECONDS` | `string` | `300` | no | otp expiry seconds | — |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | telnyx phone number | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

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
docker build -t sms-two-factor-auth .
docker run --env-file .env -p 5000:5000 sms-two-factor-auth
```

## API Reference

### `POST /auth/request-otp`

Handles `POST /auth/request-otp`.

**Request:**

```bash
curl -X POST http://localhost:5000/auth/request-otp
```

**Response:**

```json
{
  "message": "...",
  "message_id": "...",
  "expires_in_seconds": "...",
  "status_code": "..."
}
```

### `POST /auth/verify-otp`

Handles `POST /auth/verify-otp`.

**Request:**

```bash
curl -X POST http://localhost:5000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
  "code": "example_value"
}'
```

**Response:**

```json
{
  "message": "...",
  "session_token": "...",
  "authenticated": "...",
  "attempts_remaining": "..."
}
```

### `GET /auth/otp-status`

Handles `GET /auth/otp-status`.

**Request:**

```bash
curl http://localhost:5000/auth/otp-status
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
