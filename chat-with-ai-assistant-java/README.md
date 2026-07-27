---
name: chat-with-ai-assistant
title: "Chat With an AI Assistant"
description: "Chat with a Telnyx AI Assistant and thread a multi-turn conversation using the Telnyx Java SDK over a JDK HttpServer endpoint."
language: java
framework: httpserver
telnyx_products: [AI]
channel: [ai]
---

# Chat With an AI Assistant

Chat with a Telnyx AI Assistant and thread a multi-turn conversation using the Telnyx Java SDK over a JDK `HttpServer` endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network. The AI Assistants API lets you build conversational agents that you can reach over the same API key and SDK you use for everything else.

- **Conversational AI** - send a message to an assistant and get a reply, with a conversation id to thread multi-turn exchanges.
- **One platform** - AI sits next to voice, messaging, and SIP under a single API key.

## Telnyx API Endpoints Used

- **Chat with an AI Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` - via `client.ai().assistants().chat(assistantId, params)` - [API reference](https://developers.telnyx.com/api-reference/assistants/chat)

## Architecture

```
  HTTP Request (POST /chat)
        │
        ▼
  ┌──────────────────────┐
  │  JDK HttpServer       │
  │  (Application.java)    │
  └──────────┬───────────┘
             │  Telnyx Java SDK
             ▼
  ┌──────────────────────┐
  │  Telnyx AI Assistant  │
  │  Chat API             │
  └──────────┬───────────┘
             │
             └──► assistant reply + conversation_id
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, read by `TelnyxOkHttpClient.fromEnv()` | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_ASSISTANT_ID` | `string` | `assistant-abc123` | **yes** | The AI Assistant to chat with | AI → Assistants in the [Portal](https://portal.telnyx.com) |
| `PORT` | `number` | `8080` | no | Port the `HttpServer` listens on (defaults to `8080`) | - |

The Telnyx Java SDK reads `TELNYX_API_KEY` (and optional `TELNYX_BASE_URL`) directly from the process environment. Export the variables into your shell before running - see Setup.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-java
cp .env.example .env                 # ← fill in TELNYX_API_KEY and TELNYX_ASSISTANT_ID

# Export the .env values into the current shell (the SDK reads the process environment)
set -a && . ./.env && set +a

mvn compile exec:java                # starts on http://localhost:8080 (PORT from .env)
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


The server logs the routes it exposes on startup.

## API Reference

### `POST /chat`

Send a message to the AI Assistant. Pass `conversation_id` back on each follow-up turn to thread the conversation; omit it on the first turn and the server returns a freshly generated id to reuse.

```bash
curl -X POST http://localhost:8080/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What are your support hours?"}'
```

**Response:**

```json
{
  "assistant_id": "assistant-abc123",
  "conversation_id": "0b6f2d4e-9a1c-4f3b-8e2a-1c2d3e4f5a6b",
  "reply": "Our support team is available 24/7."
}
```

Follow-up turn (reusing the returned `conversation_id`):

```bash
curl -X POST http://localhost:8080/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "And on weekends?", "conversation_id": "0b6f2d4e-9a1c-4f3b-8e2a-1c2d3e4f5a6b"}'
```

### `GET /health`

Liveness probe.

```bash
curl http://localhost:8080/health
```

**Response:**

```json
{ "status": "ok" }
```

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-java/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error":"Upstream AI request failed"}` (502) | The Telnyx API rejected the call (e.g. invalid `TELNYX_API_KEY`, unknown assistant id, or rate limit). | Check the server logs for the underlying `TelnyxException`. Verify `TELNYX_API_KEY` in the [Portal](https://portal.telnyx.com/api-keys) and that `TELNYX_ASSISTANT_ID` exists under AI → Assistants. |
| `{"error":"Server is not configured"}` (500) | `TELNYX_ASSISTANT_ID` is not set in the environment. | Set it in `.env`, re-export with `set -a && . ./.env && set +a`, and restart. |
| `{"error":"Missing required field: 'message'"}` (400) | The request body had no non-empty `message` field. | Send `{"message": "..."}` with `Content-Type: application/json`. |
| `{"error":"Method not allowed"}` (405) | Wrong HTTP method (e.g. `GET /chat`). | Use `POST` for `/chat` and `GET` for `/health`. |
| `Unable to locate a Java Runtime` | No JDK 17+ on `PATH`. | Install a JDK 17+ (the SDK and this example target 17). |
| `Connection refused` on port 8080 | Server not running, or another process owns the port. | Run `mvn compile exec:java`; confirm `PORT` and that the port is free. |

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
- [create-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md) - Create an AI Assistant via API
- [list-ai-assistants-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-python/README.md) - List the AI Assistants in your account

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Chat with an Assistant - API Reference](https://developers.telnyx.com/api-reference/assistants/chat)
- [Java SDK](https://developers.telnyx.com/development/sdk/java)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [AI Inference Pricing](https://telnyx.com/pricing/inference)
