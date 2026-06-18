---
name: chat-with-ai-assistant
title: "Chat with AI Assistant"
description: "Send messages to a Telnyx AI Assistant and receive responses. Supports conversation history and streaming."
language: python
framework: flask
telnyx_products: [AI Assistants, AI Inference]
---

# Chat with AI Assistant

Send messages to a Telnyx AI Assistant and receive responses. Supports conversation history and streaming.

## Telnyx API Endpoints Used

- **AI Chat Completions**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **AI Assistant Chat**: `POST /v2/ai/assistants/{id}/messages` -- [API reference](https://developers.telnyx.com/api/ai/create-assistant-message)

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
| `AI_ASSISTANT_ID` | `string` | `your_value` | **yes** | Ai assistant id | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t chat-with-ai-assistant-python .
docker run --env-file .env -p 5000:5000 chat-with-ai-assistant-python
```

## API Reference

### `POST /chat`

HTTP endpoint to chat with an AI Assistant.

```bash
curl -X POST http://localhost:5000/chat \
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

## Testing

```bash
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What can you help me with?"}'''''' 
```

```json
{"response": "I can help you with...", "status": "ok"}
```

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/ai/assistants)

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
