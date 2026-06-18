---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Programmatically place an outbound phone call using Telnyx Call Control and handle the call lifecycle."
language: python
framework: flask
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call

Programmatically place an outbound phone call using Telnyx Call Control and handle the call lifecycle.

## Telnyx API Endpoints Used

- **Create Call**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)


## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Call Control
           ├──► Telnyx Number Porting
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `your_value` | **yes** | Telnyx phone number | — |
| `TELNYX_CONNECTION_ID` | `string` | `your_value` | **yes** | Telnyx connection id | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-python
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
docker build -t make-outbound-phone-call-python .
docker run --env-file .env -p 5000:5000 make-outbound-phone-call-python
```

## API Reference

### `POST /calls/dial`

HTTP endpoint to initiate an outbound call.

```bash
curl -X POST http://localhost:5000/calls/dial \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234"
  }'
```

**Response:**

```json
{
  "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "status": "initiated",
  "from": "+18005551234",
  "to": "+12125559876"
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
