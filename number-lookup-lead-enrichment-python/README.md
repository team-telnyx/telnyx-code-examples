---
name: number-lookup-lead-enrichment
title: "Number Lookup Lead Enrichment"
description: "Number Lookup Lead Enrichment — CNAM and carrier lookup to qualify and enrich sales leads."
language: python
framework: flask
telnyx_products: [AI Inference, Number Lookup]
---

# Number Lookup Lead Enrichment

Number Lookup Lead Enrichment — CNAM and carrier lookup to qualify and enrich sales leads.

## Telnyx API Endpoints Used

- **Number Lookup**: `GET /v2/number_lookup/{phone}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup)
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
           ├──► Telnyx Number Lookup
           ├──► Telnyx Number Porting
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
cd telnyx-code-examples/number-lookup-lead-enrichment-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t number-lookup-lead-enrichment-python .
docker run --env-file .env -p 5000:5000 number-lookup-lead-enrichment-python
```

## API Reference

### `POST /enrich`

Triggers enrich

```bash
curl -X POST http://localhost:5000/enrich \
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

### `POST /enrich/bulk`

Triggers bulk

```bash
curl -X POST http://localhost:5000/enrich/bulk \
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
