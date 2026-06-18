---
name: ai-call-center-quality-scorer
title: "AI Call Center Quality Scorer"
description: "AI Call Center Quality Scorer — automatically score agent performance from call recordings on compliance, empathy, resolution, and talk-to-listen ratio."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI Call Center Quality Scorer

AI Call Center Quality Scorer — automatically score agent performance from call recordings on compliance, empathy, resolution, and talk-to-listen ratio.

## Telnyx API Endpoints Used

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
                    Email notification
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-call-center-quality-scorer-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t ai-call-center-quality-scorer-python .
docker run --env-file .env -p 5000:5000 ai-call-center-quality-scorer-python
```

## API Reference

### `POST /score`

Triggers score

```bash
curl -X POST http://localhost:5000/score \
  -H "Content-Type: application/json" \
  -d '{}'
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

### `POST /score/batch`

Triggers batch

```bash
curl -X POST http://localhost:5000/score/batch \
  -H "Content-Type: application/json" \
  -d '{}'
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

### `GET /scorecards`

Returns scorecards

```bash
curl http://localhost:5000/scorecards
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

### `GET /scorecards/summary`

Returns summary

```bash
curl http://localhost:5000/scorecards/summary
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

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
