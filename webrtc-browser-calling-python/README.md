---
name: webrtc-browser-calling
title: "Production-ready WebRTC calling application with Telnyx Voice API and FastAPI."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice, WebRTC."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice, WebRTC]
---

# Production-ready WebRTC calling application with Telnyx Voice API and FastAPI.

Production-ready WebRTC calling application with Telnyx Voice API and FastAPI.


## Telnyx API Endpoints Used

- **WebRTC Token**: `POST /v2/webrtc_tokens` — [API reference](https://developers.telnyx.com/api/webrtc/create-token)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.initiated` — incoming call detected, app answers
- `call.answered` — call connected, app speaks greeting
- `call.hangup` — call ended, app cleans up session

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
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | telnyx phone number | — |
| `TELNYX_CONNECTION_ID` | `string` | `...` | **yes** | telnyx connection id | — |
| `WEBHOOK_URL` | `string` | `https://...` | no | webhook url | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webrtc-browser-calling-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t webrtc-browser-calling .
docker run --env-file .env -p 5000:5000 webrtc-browser-calling
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
