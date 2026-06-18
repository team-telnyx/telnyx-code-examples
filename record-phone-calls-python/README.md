---
name: record-phone-calls
title: "Production-ready Flask application for call recording via Telnyx Voice API."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for call recording via Telnyx Voice API.

Voice application. Built with Telnyx Migration, Number Porting, Voice.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.recording.saved` — Call recording saved — URL available for download/processing

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Call Recording
         ├──► Number Porting
         │
         ▼
    JSON API response

  State: Database
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
cd telnyx-code-examples/record-phone-calls-python
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
docker build -t record-phone-calls-python .
docker run --env-file .env -p 5000:5000 record-phone-calls-python
```

## API Reference

### `POST /calls/initiate`

HTTP endpoint to initiate an outbound call.

```bash
curl -X POST http://localhost:5000/calls/initiate \
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

### `POST /calls/<call_control_id>/recording/start`

HTTP endpoint to start recording an active call.

```bash
curl -X POST http://localhost:5000/calls/example-id/recording/start \
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

### `POST /calls/<call_control_id>/recording/stop`

HTTP endpoint to stop recording an active call.

```bash
curl -X POST http://localhost:5000/calls/example-id/recording/stop \
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

### `POST /calls/<call_control_id>/hangup`

HTTP endpoint to terminate an active call.

```bash
curl -X POST http://localhost:5000/calls/example-id/hangup \
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

### `GET /calls/<call_control_id>/status`

HTTP endpoint to retrieve call status and recording info.

```bash
curl http://localhost:5000/calls/example-id/status
```

**Response:**

```json
{
  "calls": [
    {
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "from": "+18005551234",
      "to": "+12125559876",
      "duration_seconds": 145,
      "status": "completed"
    }
  ]
}
```

## Webhook Endpoints

### `POST /webhooks/call-events`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.hangup`, `call.recording.saved`

**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      "call_session_id": "428c31b6-abcd-1234-5678-5013ef9657c1",
      "client_state": null,
      "from": "+12125551234",
      "to": "+13105559876",
      "direction": "incoming",
      "state": "ringing"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
