---
name: webrtc-browser-calling
title: "Production-ready WebRTC calling application with Telnyx Voice API and FastAPI."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice, WebRTC."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice, WebRTC]
---

# Production-ready WebRTC calling application with Telnyx Voice API and FastAPI.

Voice application. Built with Telnyx Migration, Number Porting, Voice, WebRTC.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.dtmf.received` — DTMF tone detected during call
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Call Transfer
         ├──► Number Porting
         ├──► DTMF Input
         │
         ▼
    Email notification

  State: Redis cache
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `your_value` | **yes** | Telnyx phone number | — |
| `TELNYX_CONNECTION_ID` | `string` | `your_value` | **yes** | Telnyx connection id | — |
| `WEBHOOK_URL` | `string` | `https://your-server.example.com` | no | Public URL for receiving webhooks | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webrtc-browser-calling-python
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
docker build -t webrtc-browser-calling-python .
docker run --env-file .env -p 5000:5000 webrtc-browser-calling-python
```

## Testing

**Get WebRTC credentials:**

```bash
curl http://localhost:5000/api/credentials
```

**Response:**

```json
{"sip_username": "user@sip.telnyx.com", "credential_id": "...", "status": "ok"}
```

**Health check:**

```bash
curl http://localhost:5000/health
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
