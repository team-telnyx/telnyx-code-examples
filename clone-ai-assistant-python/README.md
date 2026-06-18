---
name: clone-ai-assistant
title: "Production-ready Flask application for cloning AI Assistants via Telnyx."
description: "Application. Built with Telnyx AI Assistants, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
---

# Production-ready Flask application for cloning AI Assistants via Telnyx.

Application. Built with Telnyx AI Assistants, Migration, Number Porting.

## Telnyx API Endpoints Used

- **Retrieve AI Assistant**: `GET /v2/ai/assistants/{id}` — [API reference](https://developers.telnyx.com/api/ai-assistants/get-assistant)
- **Create AI Assistant**: `POST /v2/ai/assistants` — [API reference](https://developers.telnyx.com/api/ai-assistants/create-assistant)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
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
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t clone-ai-assistant-python .
docker run --env-file .env -p 5000:5000 clone-ai-assistant-python
```

## API Reference

### `GET /assistants/<assistant_id>`

Retrieve details of an assistant before cloning.

```bash
curl http://localhost:5000/assistants/example-id
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

### `POST /assistants/<assistant_id>/clone`

Clone an existing assistant with optional parameter overrides.

```bash
curl -X POST http://localhost:5000/assistants/example-id/clone \
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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
