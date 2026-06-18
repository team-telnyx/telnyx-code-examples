---
name: number-warmup-reputation-builder
title: "Number Warmup & Reputation Builder"
description: "Number Warmup & Reputation Builder — gradually ramp SMS volume on new numbers to build carrier reputation and avoid spam flags."
language: python
framework: flask
telnyx_products: [SMS/MMS]
---

# Number Warmup & Reputation Builder

Number Warmup & Reputation Builder — gradually ramp SMS volume on new numbers to build carrier reputation and avoid spam flags.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Messaging API    │
  └────────┬─────────┘
           │
           ├──► Scheduling
           ├──► Routing
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-warmup-reputation-builder-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t number-warmup-reputation-builder-python .
docker run --env-file .env -p 5000:5000 number-warmup-reputation-builder-python
```

## API Reference

### `POST /warmup/start`

Triggers start

```bash
curl -X POST http://localhost:5000/warmup/start \
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

### `POST /warmup/send`

Triggers send

```bash
curl -X POST http://localhost:5000/warmup/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response:**

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "to": "+12125551234",
  "segments": 1
}
```

### `GET /warmup/status`

Returns status

```bash
curl http://localhost:5000/warmup/status
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

### `POST /warmup/reset-daily`

Triggers reset-daily

```bash
curl -X POST http://localhost:5000/warmup/reset-daily \
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

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
