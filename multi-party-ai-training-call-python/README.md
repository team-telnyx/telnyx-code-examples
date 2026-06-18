---
name: multi-party-ai-training-call
title: "Multi-Party AI Training Call"
description: "AI plays customer roles for sales/support practice. Multiple trainees join, AI rotates scenarios and scores each trainee."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Conferencing]
integrations: [Slack]
channel: [voice]
---

# Multi-Party AI Training Call

AI plays customer roles for sales/support practice. Multiple trainees join, AI rotates scenarios and scores each trainee.

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
              ├──► SMS to customer
              ├──► Slack notification
              ├──► Email notification
              ▼
         Session Log

  External: Twilio API (source)

  State: In-memory state
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
cd telnyx-code-examples/multi-party-ai-training-call-python
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
docker build -t multi-party-ai-training-call-python .
docker run --env-file .env -p 5000:5000 multi-party-ai-training-call-python
```

## API Reference

### `POST /training/start`

Triggers start

```bash
curl -X POST http://localhost:5000/training/start \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "angry_billing",
    "trainees": ["+12125551234", "+13105559876"]
  }'
```

**Response:**

```json
{
  "session_id": "train-1750280400",
  "scenario": "angry_billing",
  "trainees": 3
}
```

### `GET /training/<sid>`

Returns sid

```bash
curl http://localhost:5000/training/example-id
```

**Response:**

```json
{
  "sessions": [
    {
      "id": "train-1750280400",
      "scenario": "angry_billing",
      "status": "completed",
      "trainees": 3,
      "scored": 3
    }
  ]
}
```

### `GET /training`

Returns training

```bash
curl http://localhost:5000/training
```

**Response:**

```json
{
  "sessions": [
    {
      "id": "train-1750280400",
      "scenario": "angry_billing",
      "status": "completed",
      "trainees": 3,
      "scored": 3
    }
  ]
}
```

### `GET /scenarios`

Returns scenarios

```bash
curl http://localhost:5000/scenarios
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
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
