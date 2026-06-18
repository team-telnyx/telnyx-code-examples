---
name: ai-meeting-action-tracker
title: "AI Meeting Action Tracker"
description: "Joins multi-party calls, identifies speakers, extracts action items with owners and deadlines, posts structured notes to Slack."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Conferencing]
integrations: [Slack]
channel: [voice]
---

# AI Meeting Action Tracker

Joins multi-party calls, identifies speakers, extracts action items with owners and deadlines, posts structured notes to Slack.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## External Service Integrations

- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))

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
  │  (Escalation)  │
  └───────────┬────────────┘
              │
              ├──► Slack notification
              ├──► Webhook callback
              ▼
         Session Log
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `SLACK_WEBHOOK` | `string` | `https://hooks.slack.com/services/T.../B.../xxx` | no | Slack incoming webhook URL | [Portal](https://api.slack.com/messaging/webhooks) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-meeting-action-tracker-python
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
docker build -t ai-meeting-action-tracker-python .
docker run --env-file .env -p 5000:5000 ai-meeting-action-tracker-python
```

## API Reference

### `POST /meetings/create`

Triggers create

```bash
curl -X POST http://localhost:5000/meetings/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Planning",
    "participants": ["+12125551234", "+13105559876", "+14155553456"]
  }'
```

**Response:**

```json
{
  "meeting_id": "mtg-1750280400",
  "status": "created",
  "participants": 3
}
```

### `GET /meetings/<mid>`

Returns mid

```bash
curl http://localhost:5000/meetings/example-id
```

**Response:**

```json
{
  "meetings": [
    {
      "id": "mtg-1750280400",
      "title": "Q3 Planning",
      "status": "active",
      "participants": 4,
      "action_items": 3
    }
  ]
}
```

### `GET /meetings`

Returns meetings

```bash
curl http://localhost:5000/meetings
```

**Response:**

```json
{
  "meetings": [
    {
      "id": "mtg-1750280400",
      "title": "Q3 Planning",
      "status": "active",
      "participants": 4,
      "action_items": 3
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
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
