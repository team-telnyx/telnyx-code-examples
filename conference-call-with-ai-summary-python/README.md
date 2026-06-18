---
name: conference-call-with-ai-summary
title: "Conference Call with AI Summary"
description: "Conference Call with AI Summary — multi-party conference with transcription and AI post-call summary."
language: python
framework: flask
telnyx_products: [AI Inference]
channel: [voice]
---

# Conference Call with AI Summary

Conference Call with AI Summary — multi-party conference with transcription and AI post-call summary.

## Telnyx API Endpoints Used

- **Conference Commands**: `POST /v2/conferences` — [API reference](https://developers.telnyx.com/api/call-control/create-conference)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)) ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.transcription` — Real-time transcription chunk received
- `message.received` — Inbound SMS/MMS received

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
  │  (Summarization)  │
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
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `CONFERENCE_NUMBER` | `string` | `your_value` | **yes** | Conference number | — |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/conference-call-with-ai-summary-python
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
docker build -t conference-call-with-ai-summary-python .
docker run --env-file .env -p 5000:5000 conference-call-with-ai-summary-python
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

### `POST /conference/<conf_id>/invite`

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

### `GET /conference/<conf_id>/summary`

Returns summary

```bash
curl http://localhost:5000/conference/example-id/summary
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

**Events handled:** `call.answered`, `call.hangup`, `call.initiated`, `call.transcription`

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
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
