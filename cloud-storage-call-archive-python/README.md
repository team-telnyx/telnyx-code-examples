---
name: cloud-storage-call-archive
title: "Cloud Storage Call Archive"
description: "Cloud Storage Call Archive — archive call recordings to Telnyx Cloud Storage with searchable metadata."
language: python
framework: flask
telnyx_products: [Cloud Storage, Migration, Number Porting, Voice]
---

# Cloud Storage Call Archive

Cloud Storage Call Archive — archive call recordings to Telnyx Cloud Storage with searchable metadata.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.recording.saved` — Call recording saved — URL available for download/processing

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Call Control
           ├──► Telnyx Cloud Storage
           ├──► Telnyx Call Recording
           │
           ▼
     Report / export
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
cd telnyx-code-examples/cloud-storage-call-archive-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t cloud-storage-call-archive-python .
docker run --env-file .env -p 5000:5000 cloud-storage-call-archive-python
```

## API Reference

### `POST /buckets`

Triggers buckets

```bash
curl -X POST http://localhost:5000/buckets \
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

### `GET /buckets`

Returns buckets

```bash
curl http://localhost:5000/buckets
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

### `POST /archive`

Triggers archive

```bash
curl -X POST http://localhost:5000/archive \
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

### `GET /archive`

Returns archive

```bash
curl http://localhost:5000/archive
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

### `GET /archive/search`

Returns search

```bash
curl http://localhost:5000/archive/search
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

### `POST /webhooks/recording`

Receives Telnyx webhook events for `/webhooks/recording`.

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
