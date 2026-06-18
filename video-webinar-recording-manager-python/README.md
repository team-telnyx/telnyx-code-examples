---
name: video-webinar-recording-manager
title: "Video Webinar Recording Manager"
description: "Video Webinar Recording Manager — manage video room webinars with automatic recording, transcription, and clip extraction."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Video Webinar Recording Manager

Video Webinar Recording Manager — manage video room webinars with automatic recording, transcription, and clip extraction.

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
                    │ • Scheduling       │
                    │ • Escalation       │
                    └────────┬─────────┘
                             │
                             ▼
                    JSON API response
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
cd telnyx-code-examples/video-webinar-recording-manager-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t video-webinar-recording-manager-python .
docker run --env-file .env -p 5000:5000 video-webinar-recording-manager-python
```

## API Reference

### `POST /webinars`

Triggers webinars

```bash
curl -X POST http://localhost:5000/webinars \
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

### `GET /webinars/<room_id>/recordings`

Returns recordings

```bash
curl http://localhost:5000/webinars/example-id/recordings
```

**Response:**

```json
{
  "recordings": [
    {
      "id": "rec-abc123",
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "duration_seconds": 145,
      "url": "https://api.telnyx.com/v2/recordings/rec-abc123/download",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /recordings/<recording_id>/transcribe`

Triggers transcribe

```bash
curl -X POST http://localhost:5000/recordings/example-id/transcribe \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "recordings": [
    {
      "id": "rec-abc123",
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "duration_seconds": 145,
      "url": "https://api.telnyx.com/v2/recordings/rec-abc123/download",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /webinars`

Returns webinars

```bash
curl http://localhost:5000/webinars
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

### `GET /recordings`

Returns recordings

```bash
curl http://localhost:5000/recordings
```

**Response:**

```json
{
  "recordings": [
    {
      "id": "rec-abc123",
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "duration_seconds": 145,
      "url": "https://api.telnyx.com/v2/recordings/rec-abc123/download",
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

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
