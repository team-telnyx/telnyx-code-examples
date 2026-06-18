---
name: video-room-ai-meeting-moderator
title: "Video Room AI Meeting Moderator"
description: "Video Room AI Meeting Moderator — create video rooms with AI-powered agenda tracking and time management."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Video Room AI Meeting Moderator

Video Room AI Meeting Moderator — create video rooms with AI-powered agenda tracking and time management.

## Telnyx API Endpoints Used

- **Video Rooms**: `POST /v2/rooms` — [API reference](https://developers.telnyx.com/api/video/create-room)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference (LLM)
           ├──► Telnyx Call Recording
           ├──► Telnyx Number Porting
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
cd telnyx-code-examples/video-room-ai-meeting-moderator-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t video-room-ai-meeting-moderator-python .
docker run --env-file .env -p 5000:5000 video-room-ai-meeting-moderator-python
```

## API Reference

### `POST /rooms`

Triggers rooms

```bash
curl -X POST http://localhost:5000/rooms \
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

### `POST /rooms/<room_id>/start`

Triggers start

```bash
curl -X POST http://localhost:5000/rooms/example-id/start \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "meeting_id": "mtg-1750280400",
  "status": "created",
  "participants": 3
}
```

### `GET /rooms/<room_id>/status`

Returns status

```bash
curl http://localhost:5000/rooms/example-id/status
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

### `POST /rooms/<room_id>/next`

Triggers next

```bash
curl -X POST http://localhost:5000/rooms/example-id/next \
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

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
