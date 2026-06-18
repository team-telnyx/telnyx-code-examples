---
name: interview-screen-scheduler
title: "Interview Screen & Scheduler"
description: "Candidate applies, AI calls for 5-min phone screen, scores answers, books qualified candidates on hiring manager's calendar. Integrates with Greenhouse ATS and Google Calendar."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Greenhouse, Slack]
channel: [voice]
---

# Interview Screen & Scheduler

Candidate applies, AI calls for 5-min phone screen, scores answers, books qualified candidates on hiring manager's calendar. Integrates with Greenhouse ATS and Google Calendar.

## Telnyx API Endpoints Used

- **Call Control: Gather (STT/DTMF)**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
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
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call         │
  │ Answered     │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     ┌──────────────────┐
  │ TTS Prompt  │────►│ Gather Speech     │
  └─────────────┘     └────────┬─────────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │ AI Inference      │
                    │ • Scheduling       │
                    │ • Escalation       │
                    └────────┬─────────┘
                             │
                    ┌────────┴────────┐
                    ├──► SMS to customer
                    ├──► Slack notification
                    └──► Email notification
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `RECRUITER_SLACK_WEBHOOK` | `string` | `your_value` | **yes** | Recruiter slack webhook | — |
| `GREENHOUSE_API_KEY` | `string` | `your_value` | **yes** | Greenhouse api key | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/interview-screen-scheduler-python
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
docker build -t interview-screen-scheduler-python .
docker run --env-file .env -p 5000:5000 interview-screen-scheduler-python
```

## API Reference

### `POST /candidates/screen`

Triggers screen

```bash
curl -X POST http://localhost:5000/candidates/screen \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /candidates`

Returns candidates

```bash
curl http://localhost:5000/candidates
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

### `POST /candidates/<int:idx>/advance`

Triggers advance

```bash
curl -X POST http://localhost:5000/candidates/<int:idx>/advance \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
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
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
