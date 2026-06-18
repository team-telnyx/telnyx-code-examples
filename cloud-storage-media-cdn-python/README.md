---
name: cloud-storage-media-cdn
title: "Cloud Storage Media CDN"
description: "Cloud Storage Media CDN — use Telnyx Cloud Storage as a CDN for IVR prompts, hold music, and voice assets."
language: python
framework: flask
telnyx_products: [Cloud Storage, Migration, Number Porting, Voice]
---

# Cloud Storage Media CDN

Cloud Storage Media CDN — use Telnyx Cloud Storage as a CDN for IVR prompts, hold music, and voice assets.

## Telnyx API Endpoints Used

- **Upload Object**: `PUT https://storage.telnyx.com/{bucket}/{key}` — [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage)
- **Download Object**: `GET https://storage.telnyx.com/{bucket}/{key}` — [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage)
- **List Objects**: `GET /v2/storage/buckets/{bucket}/objects` — [API reference](https://developers.telnyx.com/api/cloud-storage/list-objects)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Cloud Storage
           ├──► Telnyx Number Porting
           ├──► Telnyx TeXML
           │
           ▼
     Email notification
     Cloud Storage upload
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `BUCKET_NAME` | `string` | `my-bucket` | no | Telnyx Cloud Storage bucket name | [Portal](https://portal.telnyx.com/storage) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/cloud-storage-media-cdn-python
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


### Docker

```bash
docker build -t cloud-storage-media-cdn-python .
docker run --env-file .env -p 5000:5000 cloud-storage-media-cdn-python
```

## API Reference

### `POST /setup`

Triggers setup

```bash
curl -X POST http://localhost:5000/setup \
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

### `POST /upload`

Triggers upload

```bash
curl -X POST http://localhost:5000/upload \
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

### `GET /media`

Returns media

```bash
curl http://localhost:5000/media
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

### `GET /media/<category>/<name>`

Returns name

```bash
curl http://localhost:5000/media/example-id/example-id
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

### `GET /ivr-config`

Returns ivr-config

```bash
curl http://localhost:5000/ivr-config
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

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
