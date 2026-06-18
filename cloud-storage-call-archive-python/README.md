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
| `BUCKET_NAME` | `string` | `call-archive` | no | bucket name | — |

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
docker build -t cloud-storage-call-archive .
docker run --env-file .env -p 5000:5000 cloud-storage-call-archive
```

## API Reference

### `POST /buckets`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/buckets
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /buckets`

Returns all buckets.

**Request:**

```bash
curl http://localhost:5000/buckets
```

**Response:**

```json
{
  "buckets": [
    "..."
  ]
}
```

### `POST /archive`

Handles `POST /archive`.

**Request:**

```bash
curl -X POST http://localhost:5000/archive \
  -H "Content-Type: application/json" \
  -d '{
  "recording_url": "https://pay.example.com/inv-123",
  "call_id": "f\"call-{int(time.time(",
  "metadata": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok",
  "entry": "..."
}
```

### `GET /archive`

Returns all archive.

**Request:**

```bash
curl http://localhost:5000/archive
```

**Response:**

```json
{
  "recordings": "...",
  "total": 3
}
```

### `GET /archive/search`

Handles `GET /archive/search`.

**Request:**

```bash
curl http://localhost:5000/archive/search
```

**Response:**

```json
{
  "results": "...",
  "query": "..."
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

## Webhook Endpoints

### `POST /webhooks/recording`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
