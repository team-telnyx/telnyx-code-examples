---
name: build-conference-calling
title: "Production-ready Flask application for managing conference calls via Telnyx."
description: "Application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for managing conference calls via Telnyx.

Application. Built with Telnyx Migration, Number Porting, Voice.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing

## Architecture

```
  Participants (N)
    │   │   │
    ▼   ▼   ▼
  ┌───────────────────────┐
  │  Telnyx Conference     │
  │  Bridge                │
  └───────────┬────────────┘
              │
              ▼
  ┌───────────────────────┐
  │  AI Inference          │
  │  (Verification)  │
  └───────────┬────────────┘
              │
              ├──► JSON API response
              ▼
         Session Log

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
cd telnyx-code-examples/build-conference-calling-python
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
docker build -t build-conference-calling-python .
docker run --env-file .env -p 5000:5000 build-conference-calling-python
```

## API Reference

### `POST /conference/create`

HTTP endpoint to create a new conference.

```bash
curl -X POST http://localhost:5000/conference/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Planning",
    "participants": ["+12125551234", "+13105559876", "+14155553456"]
  }'
```

**Response:**

```json
{
  "conference_id": "conf-1750280400",
  "status": "created",
  "participants": 4
}
```

### `POST /conference/<conference_name>/add-participant`

HTTP endpoint to add a participant to an existing conference.

```bash
curl -X POST http://localhost:5000/conference/example-id/add-participant \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Planning",
    "participants": ["+12125551234", "+13105559876", "+14155553456"]
  }'
```

**Response:**

```json
{
  "conference_id": "conf-1750280400",
  "status": "created",
  "participants": 4
}
```

### `POST /conference/<conference_name>/end`

HTTP endpoint to end a conference and hang up all participants.

```bash
curl -X POST http://localhost:5000/conference/example-id/end \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Planning",
    "participants": ["+12125551234", "+13105559876", "+14155553456"]
  }'
```

**Response:**

```json
{
  "conference_id": "conf-1750280400",
  "status": "created",
  "participants": 4
}
```

### `GET /conference/<conference_name>/status`

HTTP endpoint to retrieve conference status.

```bash
curl http://localhost:5000/conference/example-id/status
```

**Response:**

```json
{
  "conferences": [
    {
      "id": "conf-1750280400",
      "status": "active",
      "participants": 4,
      "duration_seconds": 1800
    }
  ]
}
```

### `GET /health`

Health check endpoint.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Webhook Endpoints

### `POST /webhooks/call-events`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.hangup`

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
- [Conference Calling Guide](https://developers.telnyx.com/docs/voice/call-control/conference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
