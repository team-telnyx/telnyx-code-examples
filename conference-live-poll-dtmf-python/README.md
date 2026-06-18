---
name: conference-live-poll-dtmf
title: "Conference Live Poll via DTMF"
description: "Conference Live Poll via DTMF — host asks a question, all conference participants vote by pressing 1-4, results tallied instantly."
language: python
framework: flask
telnyx_products: [Voice]
channel: [voice]
---

# Conference Live Poll via DTMF

Conference Live Poll via DTMF — host asks a question, all conference participants vote by pressing 1-4, results tallied instantly.

## Telnyx API Endpoints Used

- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

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
  │  (Routing)  │
  └───────────┬────────────┘
              │
              ├──► JSON API response
              ▼
         Session Log
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `CONF_NUMBER` | `string` | `your_value` | **yes** | Conf number | — |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/conference-live-poll-dtmf-python
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
docker build -t conference-live-poll-dtmf-python .
docker run --env-file .env -p 5000:5000 conference-live-poll-dtmf-python
```

## API Reference

### `POST /conference/create`

Triggers create

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

### `POST /conference/<cid>/invite`

Triggers invite

```bash
curl -X POST http://localhost:5000/conference/example-id/invite \
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

### `POST /conference/<cid>/poll`

Triggers poll

```bash
curl -X POST http://localhost:5000/conference/example-id/poll \
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

### `GET /conference/<cid>/results`

Returns results

```bash
curl http://localhost:5000/conference/example-id/results
```

**Response:**

```json
{
  "results": [
    {
      "id": "eval-001",
      "score": 8.5,
      "feedback": "Strong opening, good discovery questions. Improve: handle pricing objection earlier.",
      "completed_at": "2026-07-15T14:45:00Z"
    }
  ]
}
```

### `GET /health`

Returns health

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

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.gather.ended`, `call.hangup`, `call.speak.ended`

**Example payload:**

```json
{
  "data": {
    "event_type": "call.gather.ended",
    "id": "a1b2c3d4-5678-9abc-def0-123456789abc",
    "occurred_at": "2026-07-15T14:30:15.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "client_state": "eyJzdGVwIjoibWFpbl9tZW51In0=",
      "digits": "1",
      "from": "+12125551234",
      "to": "+13105559876",
      "speech": {
        "result": "I need help with my account billing",
        "confidence": 0.94
      },
      "status": "valid"
    },
    "record_type": "event"
  }
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Conference Calling Guide](https://developers.telnyx.com/docs/voice/call-control/conference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
