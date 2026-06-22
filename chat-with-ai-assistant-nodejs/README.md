---
name: chat-with-ai-assistant
title: "Chat With AI Assistant"
description: "Send a message to a Telnyx AI Assistant and return its response over a production-ready Express endpoint."
language: nodejs
framework: express
telnyx_products: [AI Assistants]
channel: [ai]
---

# Chat With AI Assistant

Send a message to a Telnyx AI Assistant and return its response over a production-ready Express endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. AI Assistants run on that same network, so you can pair conversational AI with telephony and messaging through a single API and SDK instead of stitching together multiple vendors.

## Telnyx API Endpoints Used

- **Chat with an Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` -- [API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)

## Architecture

```
  POST /chat  { "message": "..." }
        │
        ▼
  ┌──────────────────────┐
  │ Express (server.js)   │
  │  chatWithAssistant()  │
  └──────────┬───────────┘
             │  client.ai.assistants.chat(assistantId, {messages})
             ▼
  ┌──────────────────────┐
  │ Telnyx AI Assistant   │
  └──────────┬───────────┘
             │
             └──► assistant_response (JSON)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_ASSISTANT_ID` | `string` | `assistant-1234abcd` | **yes** | ID of the AI Assistant to chat with | [Portal](https://portal.telnyx.com/ai/assistants) |
| `PORT` | `number` | `5000` | no | Port the server listens on (defaults to `3000`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

## API Reference

### `POST /chat`

Send a message to the configured AI Assistant and receive its response. The assistant is selected by the `AI_ASSISTANT_ID` environment variable, not the request body.

```bash
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are your business hours?"
  }'
```

**Response:**

```json
{
  "assistant_id": "assistant-1234abcd",
  "user_message": "What are your business hours?",
  "assistant_response": "We are open Monday to Friday, 9am to 5pm.",
  "timestamp": "2026-06-18T14:32:00.000Z"
}
```

### `GET /health`

Liveness check.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Connection refused` on port 5000 | Server isn't running, or it bound to a different port. | Run `node server.js`. If `PORT` is unset the server defaults to `3000`; set `PORT=5000` in `.env` to match these examples. |
| `{"error": "Invalid API key"}` (401) | `TELNYX_API_KEY` is missing or wrong. | Generate a key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`. Remove any quotes or trailing spaces. |
| `{"error": "AI_ASSISTANT_ID environment variable not set"}` (500) | `AI_ASSISTANT_ID` is not present in the environment. | Add `AI_ASSISTANT_ID` to `.env` and restart the server. Confirm the file is named exactly `.env`. |
| `{"error": "Missing required field: 'message'"}` (400) | Request body has no `message`. | Send a JSON body like `{"message": "Hello"}` with `Content-Type: application/json`. |
| `{"error": "Message cannot be empty"}` (400) | `message` is blank or whitespace-only. | Provide a `message` with at least one non-whitespace character. |
| `{"error": "Rate limit exceeded. Please slow down."}` (429) | Too many requests for your account plan. | Back off and retry after ~60 seconds; add exponential backoff in your client. |

## Related Examples

- [create-ai-assistant-nodejs](../create-ai-assistant-nodejs/) - Create an AI Assistant to chat with
- [list-ai-assistants-nodejs](../list-ai-assistants-nodejs/) - List assistants to find an `AI_ASSISTANT_ID`
- [chat-with-ai-assistant-python](../chat-with-ai-assistant-python/) - The Python version of this example

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Chat with an Assistant API Reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [AI Pricing](https://telnyx.com/pricing/inference)
