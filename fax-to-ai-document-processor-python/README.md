---
name: fax-to-ai-document-processor
title: "Fax to AI Document Processor"
description: "Fax to AI Document Processor — receive fax, AI extracts data, forwards structured summary."
language: python
framework: flask
telnyx_products: [SMS/MMS, AI Inference]
---

# Fax to AI Document Processor

Fax to AI Document Processor — receive fax, AI extracts data, forwards structured summary.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
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
  │  Parse Message    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │  AI Inference     │
  │  • Classification  │
  │  • Summarization   │
  └────────┬─────────┘
           │
           ├──► Email notification
           ├──► Payment processing
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `FAX_NUMBER` | `string` | `your_value` | **yes** | Fax number | — |
| `FORWARD_EMAIL` | `string` | `your_value` | **yes** | Forward email | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/fax-to-ai-document-processor-python
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
docker build -t fax-to-ai-document-processor-python .
docker run --env-file .env -p 5000:5000 fax-to-ai-document-processor-python
```

## API Reference

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
