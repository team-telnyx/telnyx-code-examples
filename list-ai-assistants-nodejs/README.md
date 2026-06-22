---
name: list-ai-assistants
title: "List AI Assistants"
description: "List all AI assistants in your Telnyx account using the Telnyx Node.js SDK and an Express endpoint."
language: nodejs
framework: express
telnyx_products: [AI Assistants]
channel: [ai]
---

# List AI Assistants

List all AI assistants in your Telnyx account using the Telnyx Node.js SDK and an Express endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. AI Assistants are managed through the same API surface as the rest of your communications stack, so listing, creating, and operating assistants happens with a single SDK and a single API key.

- **One platform** — build, list, and run AI assistants alongside voice and messaging without stitching together multiple vendors.
- **Developer-first SDKs** — the Node.js SDK exposes typed errors so you can map Telnyx failures to clean HTTP responses.

## Telnyx API Endpoints Used

- **List Assistants**: `GET /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api-reference/assistants/get-assistants)

## Architecture

```
  GET /assistants
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │   (server.js)     │
  └────────┬─────────┘
           │ client.ai.assistants.list()
           ▼
  ┌──────────────────┐
  │ Telnyx AI         │
  │ Assistants API    │
  └────────┬─────────┘
           │
           └──► JSON array of assistants
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

The startup logs print the exact curl commands for the running port.

## API Reference

### `GET /assistants`

Retrieve all AI assistants from your Telnyx account. Returns a JSON object with a success flag, a count, and a `data` array of assistant objects.

```bash
curl http://localhost:5000/assistants
```

**Response:**

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "assistant-f5d7a7e0-1234-5678",
      "name": "Support Bot",
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "instructions": "You are a helpful support assistant.",
      "enabled_features": ["telephony"],
      "created_at": "2025-01-15T12:00:00Z"
    }
  ]
}
```

### `GET /health`

Liveness probe. Returns `200` while the server is up.

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
| `401` with `{"error": "Invalid API key..."}` | `TELNYX_API_KEY` is missing, wrong, or has trailing spaces/quotes. | Copy the key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env`, then restart `node server.js`. |
| `count: 0` and an empty `data` array | No AI assistants exist in the account yet. | Create one in the [Telnyx Portal](https://portal.telnyx.com) or with the Create Assistant API, then retry. |
| `429` with `{"error": "Rate limit exceeded..."}` | Too many requests in a short window. | Retry after a short delay and add backoff if you poll frequently. |
| `503` with `{"error": "Network error connecting to Telnyx..."}` | The server could not reach `api.telnyx.com`. | Check connectivity, firewall, and proxy settings, then retry. |
| `Error: Cannot find module 'telnyx'` | Dependencies are not installed. | Run `npm install` in the example directory. |
| `Error: listen EADDRINUSE` | The chosen port is already in use. | Set a free port via `PORT=5001 node server.js` or stop the process holding the port (`lsof -i :5000`). |

## Related Examples

- [create-ai-assistant-nodejs](../create-ai-assistant-nodejs/) - Create a new AI assistant
- [chat-with-ai-assistant-nodejs](../chat-with-ai-assistant-nodejs/) - Send messages to an assistant
- [list-ai-assistants-python](../list-ai-assistants-python/) - Same example in Python

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [List Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/get-assistants)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Pricing](https://telnyx.com/pricing/inference)
