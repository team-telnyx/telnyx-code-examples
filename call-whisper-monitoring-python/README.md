---
name: call-whisper-monitoring
title: "Production-ready Flask application for Whisper-based call prompts via Telnyx."
description: "Voice application. Built with Telnyx AI Assistants, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting, SMS/MMS, Voice]
---

# Production-ready Flask application for Whisper-based call prompts via Telnyx.

Production-ready Flask application for Whisper-based call prompts via Telnyx.


## Telnyx API Endpoints Used

- **Call Control: Whisper**: `POST /v2/calls/{id}/actions/bridge` — [API reference](https://developers.telnyx.com/api/call-control/bridge-call)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

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
| `OPENAI_API_KEY` | `string` | `...` | **yes** | openai api key | — |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | telnyx phone number | — |
| `TELNYX_CONNECTION_ID` | `string` | `...` | **yes** | telnyx connection id | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t call-whisper-monitoring .
docker run --env-file .env -p 5000:5000 call-whisper-monitoring
```

## API Reference

### `POST /calls/initiate`

Handles `POST /calls/initiate`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/initiate
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /calls/<call_control_id>/status`

Returns call status details.

**Request:**

```bash
curl http://localhost:5000/calls/example-id/status
```

**Response:**

```json
{
  "call_control_id": "...",
  "is_alive": "...",
  "state": "...",
  "transcript": "...",
  "status_code": "..."
}
```

## Webhook Endpoints

### `POST /webhooks/call`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
