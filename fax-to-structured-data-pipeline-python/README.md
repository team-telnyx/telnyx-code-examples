---
name: fax-to-structured-data-pipeline
title: "Fax-to-Structured-Data Pipeline"
description: "Fax-to-Structured-Data Pipeline — receive faxes, AI extracts structured data (invoices, orders, prescriptions) into JSON."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Fax-to-Structured-Data Pipeline

Fax-to-Structured-Data Pipeline — receive faxes, AI extracts structured data (invoices, orders, prescriptions) into JSON.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events:

- `fax.received` — Inbound fax received — media URL available

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
           ├──► Telnyx Number Porting
           ├──► Telnyx Fax API
           │
           ▼
     Payment processing
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
cd telnyx-code-examples/fax-to-structured-data-pipeline-python
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

   - **Fax Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/fax`

### Docker

```bash
docker build -t fax-to-structured-data-pipeline-python .
docker run --env-file .env -p 5000:5000 fax-to-structured-data-pipeline-python
```

## API Reference

### `POST /extract`

Triggers extract

```bash
curl -X POST http://localhost:5000/extract \
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

### `GET /faxes`

Returns faxes

```bash
curl http://localhost:5000/faxes
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

### `GET /extracted`

Returns extracted

```bash
curl http://localhost:5000/extracted
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

### `POST /webhooks/fax`

Receives [Telnyx Fax](https://developers.telnyx.com/docs/fax) webhook events.

**Example payload:**

```json
{
  "data": {
    "event_type": "fax.received",
    "id": "b7c8d9e0-1234-5678-9abc-def012345678",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "fax_id": "b7c8d9e0-1234-5678-9abc-def012345678",
      "direction": "inbound",
      "from": "+12125551234",
      "to": "+13105559876",
      "status": "received",
      "media_url": "https://api.telnyx.com/v2/faxes/b7c8d9e0/media",
      "page_count": 3,
      "quality": "fine"
    },
    "record_type": "event"
  }
}
```

## Resources

- [Fax Guide](https://developers.telnyx.com/docs/fax)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
