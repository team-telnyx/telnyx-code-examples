---
name: list-ai-assistants
title: "List AI Assistants"
description: "List all Telnyx AI Assistants in your account with filtering and pagination."
language: python
framework: flask
telnyx_products: [AI Assistants]
---

# List AI Assistants

List all Telnyx AI Assistants in your account with filtering and pagination.

## Telnyx API Endpoints Used

- **List AI Assistants**: `GET /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api/ai/list-assistants)

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
cd telnyx-code-examples/list-ai-assistants-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t list-ai-assistants-python .
docker run --env-file .env -p 5000:5000 list-ai-assistants-python
```

## API Reference

### `GET /assistants`

Return all AI Assistants as a JSON array.

```bash
curl http://localhost:5000/assistants
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

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/ai/assistants)

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
