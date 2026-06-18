---
name: update-ai-assistant
title: "Production-ready FastAPI endpoint for updating AI assistants via Telnyx."
description: "Application. Built with Telnyx AI Assistants, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
---

# Production-ready FastAPI endpoint for updating AI assistants via Telnyx.

Production-ready FastAPI endpoint for updating AI assistants via Telnyx.


## Telnyx API Endpoints Used

- **AI Assistants: Update**: `PATCH /v2/ai/assistants/{id}` — [API reference](https://developers.telnyx.com/api/ai-assistants/update-assistant)


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
docker build -t update-ai-assistant .
docker run --env-file .env -p 5000:5000 update-ai-assistant
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
