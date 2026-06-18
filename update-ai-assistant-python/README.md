---
name: update-ai-assistant
title: "Update AI Assistant"
description: "Update an existing Telnyx AI Assistant's configuration, model, system prompt, and tools via the API."
language: python
framework: flask
telnyx_products: [AI Assistants]
---

# Update AI Assistant

Update an existing Telnyx AI Assistant's configuration, model, system prompt, and tools via the API.

## Telnyx API Endpoints Used

- **Update AI Assistant**: `PATCH /v2/ai/assistants/{id}` -- [API reference](https://developers.telnyx.com/api/ai/update-assistant)
- **Get AI Assistant**: `GET /v2/ai/assistants/{id}` -- [API reference](https://developers.telnyx.com/api/ai/get-assistant)

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

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/update-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t update-ai-assistant-python .
docker run --env-file .env -p 5000:5000 update-ai-assistant-python
```

## API Reference

### Example Request

```bash
curl -X PATCH http://localhost:5000/assistants/asst_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Sales Bot",
    "model": "moonshotai/Kimi-K2.6",
    "instructions": "You are a helpful sales assistant..."
  }' 
```

**Response:**

```json
{
  "id": "asst_abc123",
  "name": "Updated Sales Bot",
  "model": "moonshotai/Kimi-K2.6",
  "instructions": "You are a helpful sales assistant...",
  "tools": ["search_products", "check_inventory"],
  "updated_at": "2026-07-15T14:30:00Z"
}
```

### Health Check

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "ok"
}
```

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/ai/assistants)

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
