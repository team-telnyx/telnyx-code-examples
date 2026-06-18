---
name: text-to-speech-phone-call
title: "Production-ready Flask application for text-to-speech calls via Telnyx."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for text-to-speech calls via Telnyx.

Production-ready Flask application for text-to-speech calls via Telnyx.


## Telnyx API Endpoints Used

- **Call Control: Speak**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.initiated` — incoming call detected, app answers
- `call.answered` — call connected, app speaks greeting
- `call.speak.ended` — TTS finished, app starts listening
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
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t text-to-speech-phone-call .
docker run --env-file .env -p 5000:5000 text-to-speech-phone-call
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

### `POST /calls/<call_control_id>/speak`

Handles `POST /calls/<call_control_id>/speak`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/example-id/speak \
  -H "Content-Type: application/json" \
  -d '{
  "language": "en-US"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /calls/<call_control_id>/hangup`

Handles `POST /calls/<call_control_id>/hangup`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/example-id/hangup
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /calls/status`

Returns calls status details.

**Request:**

```bash
curl http://localhost:5000/calls/status
```

**Response:**

```json
{
  "active_calls": 3
}
```

## Webhook Endpoints

### `POST /webhooks/call`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
