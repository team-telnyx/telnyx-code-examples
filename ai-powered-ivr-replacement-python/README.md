---
name: ai-powered-ivr-replacement
title: "AI-Powered IVR Replacement"
description: "AI-Powered IVR Replacement — natural language routing with A/B testing and structured insights."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
---

# AI-Powered IVR Replacement

AI-Powered IVR Replacement — natural language routing with A/B testing and structured insights.


## Telnyx API Endpoints Used

- **Call Control**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.initiated` — incoming call detected, app answers

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
| `ASSISTANT_ID` | `string` | `...` | **yes** | assistant id | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-powered-ivr-replacement-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t ai-powered-ivr-replacement .
docker run --env-file .env -p 5000:5000 ai-powered-ivr-replacement
```

## API Reference

### `POST /setup`

Handles `POST /setup`.

**Request:**

```bash
curl -X POST http://localhost:5000/setup
```

**Response:**

```json
{
  "status": "ok",
  "assistant_id": "..."
}
```

### `GET /analytics`

Returns analytics details.

**Request:**

```bash
curl http://localhost:5000/analytics
```

**Response:**

```json
{
  "total_calls": 3,
  "ai_resolution_rate": "...",
  "transfer_rate": "...",
  "department_distribution": "...",
  "ab_test_results": "...",
  "recent_calls": "..."
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Webhook Endpoints

### `POST /webhooks/assistant`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
