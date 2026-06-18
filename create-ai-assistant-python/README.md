---
name: create-ai-assistant
title: "Create AI Assistant"
description: "Create a new Telnyx AI Assistant with a system prompt, model selection, and tool configuration."
language: python
framework: flask
telnyx_products: [AI Assistants]
---

# Create AI Assistant

Create a new Telnyx AI Assistant with a system prompt, model selection, and tool configuration.

## Telnyx API Endpoints Used

- **Create AI Assistant**: `POST /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api/ai/create-assistant)

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
cd telnyx-code-examples/create-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t create-ai-assistant-python .
docker run --env-file .env -p 5000:5000 create-ai-assistant-python
```

## API Reference

### `POST /ai/assistants`

HTTP endpoint to create AI assistant.

```bash
curl -X POST http://localhost:5000/ai/assistants \
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

- [AI Assistants Guide](https://developers.telnyx.com/docs/ai/assistants)

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
