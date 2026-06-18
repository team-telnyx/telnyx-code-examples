---
name: clone-ai-assistant
title: "Production-ready Flask application for cloning AI Assistants via Telnyx."
description: "Application. Built with Telnyx AI Assistants, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
---

# Production-ready Flask application for cloning AI Assistants via Telnyx.

Production-ready Flask application for cloning AI Assistants via Telnyx.


## Telnyx API Endpoints Used

- **AI Assistants: Clone**: `POST /v2/ai/assistants/{id}/clone` — [API reference](https://developers.telnyx.com/api/ai-assistants/clone-assistant)


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
cd telnyx-code-examples/clone-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t clone-ai-assistant .
docker run --env-file .env -p 5000:5000 clone-ai-assistant
```

## API Reference

### `GET /assistants/<assistant_id>`

Returns assistant details.

**Request:**

```bash
curl http://localhost:5000/assistants/example-id
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /assistants/<assistant_id>/clone`

Handles `POST /assistants/<assistant_id>/clone`.

**Request:**

```bash
curl -X POST http://localhost:5000/assistants/example-id/clone \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Jane Doe",
  "instructions": "example_value"
}'
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
