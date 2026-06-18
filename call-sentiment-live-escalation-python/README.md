---
name: call-sentiment-live-escalation
title: "Call Sentiment Live Escalation"
description: "Call Sentiment Live Escalation — monitor call transcripts in real-time. When negative sentiment or distress is detected, auto-escalate to a supervisor."
language: python
framework: flask
telnyx_products: [SMS/MMS, AI Inference]
---

# Call Sentiment Live Escalation

Call Sentiment Live Escalation — monitor call transcripts in real-time. When negative sentiment or distress is detected, auto-escalate to a supervisor.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  API Request
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
                    │ • Escalation       │
                    │ • Scoring          │
                    └────────┬─────────┘
                             │
                             ▼
                    SMS to customer
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `SUPERVISOR_NUMBER` | `string` | `your_value` | **yes** | Supervisor number | — |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-sentiment-live-escalation-python
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
docker build -t call-sentiment-live-escalation-python .
docker run --env-file .env -p 5000:5000 call-sentiment-live-escalation-python
```

## API Reference

### `POST /monitor`

Triggers monitor

```bash
curl -X POST http://localhost:5000/monitor \
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

### `POST /transcript`

Triggers transcript

```bash
curl -X POST http://localhost:5000/transcript \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "transcript": [
    {
      "time": 1750280400.0,
      "speaker": "...1234",
      "text": "I think we should proceed with option B"
    },
    {
      "time": 1750280415.0,
      "speaker": "...5678",
      "text": "Agreed, let me draft the proposal"
    }
  ],
  "summary": "Team agreed to proceed with option B. Proposal draft assigned."
}
```

### `GET /calls/<call_id>/sentiment`

Returns sentiment

```bash
curl http://localhost:5000/calls/example-id/sentiment
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

### `GET /escalations`

Returns escalations

```bash
curl http://localhost:5000/escalations
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

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
