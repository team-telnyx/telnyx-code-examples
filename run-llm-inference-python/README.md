---
name: run-llm-inference
title: "Run LLM inference on Telnyx — OpenAI-compatible chat completions API."
description: "Application powered by Telnyx AI Inference. Built with Telnyx AI Inference, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Run LLM inference on Telnyx — OpenAI-compatible chat completions API.

Application powered by Telnyx AI Inference. Built with Telnyx AI Inference, Migration, Number Porting, SMS/MMS.

## Telnyx API Endpoints Used

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
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/run-llm-inference-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t run-llm-inference-python .
docker run --env-file .env -p 5000:5000 run-llm-inference-python
```

## API Reference

### `POST /inference/chat`

HTTP endpoint for chat completions — pass through to Telnyx Inference.

```bash
curl -X POST http://localhost:5000/inference/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I set up a voice AI agent with Telnyx?"
  }'
```

**Response:**

```json
{
  "response": "Based on the Telnyx API documentation, you can implement programmable voice using Call Control...",
  "model": "moonshotai/Kimi-K2.6",
  "tokens_used": 284
}
```

### `POST /inference/ask`

Simplified endpoint — send a question, get an answer.

```bash
curl -X POST http://localhost:5000/inference/ask \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "response": "Based on the Telnyx API documentation, you can implement programmable voice using Call Control...",
  "model": "moonshotai/Kimi-K2.6",
  "tokens_used": 284
}
```

### `GET /health`

Health check.

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
