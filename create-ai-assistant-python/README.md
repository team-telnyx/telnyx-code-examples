---
name: create-ai-assistant
title: "Production-ready Flask endpoint for creating AI assistants via Telnyx."
description: "Application. Built with Telnyx AI Assistants, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting, SMS/MMS]
---

# Production-ready Flask endpoint for creating AI assistants via Telnyx.

Production-ready Flask endpoint for creating AI assistants via Telnyx.


## Telnyx API Endpoints Used

- **AI Assistants: Create**: `POST /v2/ai/assistants` — [API reference](https://developers.telnyx.com/api/ai-assistants/create-assistant)


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
cd telnyx-code-examples/create-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t create-ai-assistant .
docker run --env-file .env -p 5000:5000 create-ai-assistant
```

## API Reference

### `POST /ai/assistants`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/ai/assistants \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Jane Doe",
  "instructions": "example_value",
  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
  "enabled_features": "[\"messaging\"]"
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
