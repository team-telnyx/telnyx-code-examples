---
name: chat-with-ai-assistant
title: "Chat with a Telnyx AI Assistant"
description: "Send messages to a Telnyx AI assistant and maintain multi-turn context with a conversation id, using a Go + Gin server."
language: go
framework: gin
telnyx_products: [AI]
channel: [ai]
---

# Chat with a Telnyx AI Assistant

Send messages to a Telnyx AI assistant and maintain multi-turn context with a conversation id, using a Go + Gin server.

## Telnyx API Endpoints Used

- **Chat with an Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` -- [API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- **Create a Conversation**: `POST /v2/ai/conversations` -- [API reference](https://developers.telnyx.com/api-reference/conversations/create-a-conversation)

## Architecture

```
  Client (curl / app)
        │
        │  POST /chat  { message, conversation_id? }
        ▼
  ┌──────────────────┐
  │  Gin server       │
  │  POST /chat       │
  └────────┬─────────┘
           │  (1) no conversation_id?
           │      └─► Create Conversation  ──► Telnyx AI
           │             returns conversation_id
           │
           │  (2) Chat with Assistant (content + conversation_id)
           └────────────────────────────────► Telnyx AI
                         returns assistant reply
        ▲
        │  { conversation_id, reply }
        │
  Client echoes conversation_id on the next turn
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Assistants with built-in memory** - the Conversations API gives each thread a stable `conversation_id`, so the assistant keeps context across turns without you managing message history yourself.
- **One API key, one SDK** - the same credential that powers voice and messaging also drives AI assistants, so you can move an assistant from chat to phone or SMS without re-plumbing auth.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API v2 key used to authenticate AI assistant requests | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_ASSISTANT_ID` | `string` | `assistant-abc123` | **yes** | ID of the AI assistant to chat with | [AI Assistants](https://portal.telnyx.com/#/ai/assistants) |
| `PORT` | `string` | `8080` | no | Port the Gin server listens on. Defaults to `8080` when unset | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-go
cp .env.example .env    # ← fill in your credentials and assistant ID
go mod download
go run .                # starts on the PORT from .env (default 8080)
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


## API Reference

### `GET /health`

Liveness probe. Returns `200` when the server is running.

```bash
curl http://localhost:8080/health
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /chat`

Sends one user turn to the assistant. Omit `conversation_id` on the first request to start a new thread; the response includes the `conversation_id` you must echo back on every subsequent request to keep context.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | **yes** | The user's message to the assistant |
| `conversation_id` | `string` | no | Existing thread id. Omit to start a new conversation |

**First turn (no `conversation_id`):**

```bash
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{ "message": "What are your support hours?" }'
```

**Response:**

```json
{
  "conversation_id": "8d1b...e2f",
  "reply": "Our support team is available 24/7."
}
```

**Follow-up turn (reuse `conversation_id`):**

```bash
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{ "message": "And on weekends?", "conversation_id": "8d1b...e2f" }'
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `TELNYX_API_KEY is required` on startup | The API key is missing from the environment. | Set `TELNYX_API_KEY` in `.env` with a valid key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys). |
| `TELNYX_ASSISTANT_ID is required` on startup | No assistant ID configured. | Create an assistant in the [Portal](https://portal.telnyx.com/#/ai/assistants) and set its ID in `.env`. |
| `Failed to chat with assistant` (401) | The API key is invalid or lacks AI permissions. | Verify the key in the Portal and confirm AI is enabled on your account. |
| `Failed to chat with assistant` (404) | The `TELNYX_ASSISTANT_ID` does not match an existing assistant. | Copy the exact ID from the AI Assistants page in the Portal. |
| `Failed to chat with assistant` (400) | The conversation has `ai_disabled` set to `true`, or the message is empty. | Start a new conversation (omit `conversation_id`) or re-enable AI on the thread. |
| `message is required` (400) | The request body had an empty or missing `message`. | Send a non-empty `message` field. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx ai-assistants list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) - Same example in Python
- [chat-with-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-nodejs/README.md) - Same example in Node.js
- [create-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md) - Create an AI assistant before chatting with it
- [route-phone-calls-to-ai-agent-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-go/README.md) - Connect calls to an AI agent with the Telnyx Go SDK and Gin

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Assistants Overview](https://developers.telnyx.com/docs/inference/ai-assistants/overview)
- [Chat with an Assistant API Reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- [Create a Conversation API Reference](https://developers.telnyx.com/api-reference/conversations/create-a-conversation)
- [Telnyx Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [AI Assistants Pricing](https://telnyx.com/pricing/inference)
