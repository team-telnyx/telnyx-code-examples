---
name: verify-phone-number-otp-flow
title: "Verify Phone Number OTP Flow"
description: "Verify Phone Number OTP Flow — Telnyx Verify API with SMS primary and voice call fallback."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Verify]
channel: [voice]
---

# Verify Phone Number OTP Flow

Verify Phone Number OTP Flow — Telnyx Verify API with SMS primary and voice call fallback.


## Telnyx API Endpoints Used

- **Verify**: `POST /v2/verifications` — [API reference](https://developers.telnyx.com/api/verify/create-verification)


## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│  Phone Call  │────►│   Telnyx   │────►│  POST /webhooks/voice│
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
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
| `VERIFY_PROFILE_ID` | `string` | `...` | **yes** | verify profile id | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/verify-phone-number-otp-flow-python
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
docker build -t verify-phone-number-otp-flow .
docker run --env-file .env -p 5000:5000 verify-phone-number-otp-flow
```

## API Reference

### `POST /verify/start`

Handles `POST /verify/start`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/start
```

**Response:**

```json
{
  "status": "ok",
  "phone": "..."
}
```

### `POST /verify/voice-fallback`

Handles `POST /verify/voice-fallback`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/voice-fallback
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /verify/check`

Handles `POST /verify/check`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/check \
  -H "Content-Type: application/json" \
  -d '{
  "code": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
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
