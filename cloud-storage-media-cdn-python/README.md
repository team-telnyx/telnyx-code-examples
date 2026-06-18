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

- **Cloud Storage (S3)**: `S3-compatible API` — [API reference](https://developers.telnyx.com/api/cloud-storage)


## Architecture

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `BUCKET_NAME` | `string` | `media-cdn` | no | bucket name | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/cloud-storage-media-cdn-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t cloud-storage-media-cdn .
docker run --env-file .env -p 5000:5000 cloud-storage-media-cdn
```

## API Reference

### `POST /setup`

Handles `POST /setup`.

**Request:**

```bash
curl -X POST http://localhost:5000/setup
```

**Response:**

```json
{
  "status": "ok",
  "bucket": "...",
  "categories": "..."
}
```

### `POST /upload`

Handles `POST /upload`.

**Request:**

```bash
curl -X POST http://localhost:5000/upload \
  -H "Content-Type: application/json" \
  -d '{
  "category": "ivr_prompts",
  "name": "Jane Doe",
  "url": "https://pay.example.com/inv-123"
}'
```

**Response:**

```json
{
  "status": "ok",
  "entry": "..."
}
```

### `GET /media`

Returns all media.

**Request:**

```bash
curl http://localhost:5000/media
```

**Response:**

```json
{
  "media": "...",
  "category": "..."
}
```

### `GET /media/<category>/<name>`

Returns media url details.

**Request:**

```bash
curl http://localhost:5000/media/example-id/example-id
```

**Response:**

```json
{
  "url": "...",
  "item": "..."
}
```

### `GET /ivr-config`

Handles `GET /ivr-config`.

**Request:**

```bash
curl http://localhost:5000/ivr-config
```

**Response:**

```json
{
  "ivr_prompts": "...",
  "hold_music": "...",
  "usage": "..."
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
