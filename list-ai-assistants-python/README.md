---
name: list-ai-assistants
title: "Production-ready Flask endpoint for listing Telnyx AI Assistants."
description: "Application. Built with Telnyx AI Assistants, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
---

# Production-ready Flask endpoint for listing Telnyx AI Assistants.

Production-ready Flask endpoint for listing Telnyx AI Assistants.


## Telnyx API Endpoints Used

- **AI Assistants: List**: `GET /v2/ai/assistants` — [API reference](https://developers.telnyx.com/api/ai-assistants/list-assistants)


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
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

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
docker build -t list-ai-assistants .
docker run --env-file .env -p 5000:5000 list-ai-assistants
```

## API Reference

### `GET /assistants`

Returns all assistants.

**Request:**

```bash
curl http://localhost:5000/assistants
```

**Response:**

```json
{
  "status_code": "..."
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
