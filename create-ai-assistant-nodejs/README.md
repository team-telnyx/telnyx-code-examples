---
name: create-ai-assistant
title: "Create AI Assistant"
description: "Create a Telnyx AI Assistant over an HTTP endpoint using the Telnyx Node.js SDK and Express."
language: nodejs
framework: express
telnyx_products: [AI Assistants]
channel: [voice, sms]
---

# Create AI Assistant

Create a Telnyx AI Assistant over an HTTP endpoint using the Telnyx Node.js SDK and Express.

## Telnyx API Endpoints Used

- **Create Assistant**: `POST /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)

## Architecture

```
  POST /assistants/create
            │
            ▼
  ┌──────────────────────┐
  │  Express (server.js)  │
  │  createAssistant()    │
  └──────────┬───────────┘
             │ client.ai.assistants.create()
             ▼
  ┌──────────────────────┐
  │  Telnyx AI Assistants │
  └──────────┬───────────┘
             │
             └──► assistant id + config (JSON)
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. AI Assistants run natively on that network, so the same assistant can answer telephony calls and reply to messages without stitching together separate vendors.

- **Native AI** — assistants ship with built-in LLM hosting, telephony, and messaging.
- **Single SDK** — `telnyx` for Node.js wraps every endpoint, including `ai.assistants`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000 (PORT from .env)
```

## API Reference

### `POST /assistants/create`

Create a new AI assistant. All four fields are required.

```bash
curl -X POST http://localhost:5000/assistants/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Bot",
    "instructions": "You are a friendly customer support agent for Acme Corp.",
    "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
    "enabled_features": ["telephony", "messaging"]
  }'
```

**Response `201`:**

```json
{
  "id": "assistant-abc123",
  "name": "Support Bot",
  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
  "instructions": "You are a friendly customer support agent for Acme Corp.",
  "enabled_features": ["telephony", "messaging"],
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

**Response `200`:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Invalid API key` (401) | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace. | Copy the key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env`, then restart `node server.js`. |
| `Missing required fields...` (400) | The request body is missing `name`, `instructions`, `model`, or `enabled_features`. | Send all four fields as JSON; `enabled_features` must be a non-empty array such as `["telephony"]`. |
| `Rate limit exceeded` (429) | Too many requests in a short window. | Back off and retry with exponential delay. |
| `Network error connecting to Telnyx` (503) | The server cannot reach `api.telnyx.com`. | Check connectivity, firewall, and proxy settings. |
| `Internal server error` (500) | Unhandled error, often an invalid `model` ID rejected by Telnyx. | Use a supported model ID and inspect server logs for detail. |
| Connection refused on port 5000 | Server not running, or `PORT` differs from your request URL. | Start the server and match the URL to the `PORT` in `.env` (defaults to `3000` if unset). |

## Related Examples

- [list-ai-assistants-nodejs](../list-ai-assistants-nodejs/) - List your AI assistants
- [chat-with-ai-assistant-nodejs](../chat-with-ai-assistant-nodejs/) - Send messages to an assistant
- [create-ai-assistant-python](../create-ai-assistant-python/) - Same example in Python

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Create an Assistant — API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Pricing](https://telnyx.com/pricing/inference)
