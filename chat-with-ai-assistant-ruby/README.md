---
name: chat-with-ai-assistant
title: "Chat With AI Assistant"
description: "Chat with a Telnyx AI Assistant and maintain conversation context over a production-ready Sinatra endpoint using the Telnyx Ruby SDK."
language: ruby
framework: sinatra
telnyx_products: [AI Assistants]
channel: [ai]
---

# Chat With AI Assistant (Ruby)

Chat with a Telnyx AI Assistant and maintain conversation context over a production-ready Sinatra endpoint using the Telnyx Ruby SDK.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. AI Assistants run on that same network, so you can pair conversational AI with telephony and messaging through a single API and SDK instead of stitching together multiple vendors.

- **One API, one SDK** - the same `Telnyx::Client` that sends SMS and dials calls also chats with assistants.
- **Stateful conversations** - reuse a `conversation_id` across turns to keep multi-turn context server-side.
- **Developer-first** - pay-as-you-go pricing, sandbox testing, and a comprehensive webhook event model.

## Telnyx API Endpoints Used

- **Chat with an Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` - [API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)

## Architecture

```
  POST /chat  { "message": "...", "conversation_id": "..." }
        │
        ▼
  ┌──────────────────────────┐
  │ Sinatra (app.rb)          │
  │  chat_with_assistant()    │
  └──────────┬───────────────┘
             │  CLIENT.ai.assistants.chat(assistant_id,
             │      content:, conversation_id:, name:)
             ▼
  ┌──────────────────────────┐
  │ Telnyx AI Assistant       │
  └──────────┬───────────────┘
             │
             └──► { assistant_response, conversation_id } (JSON)

  Optional inbound events:
  POST /webhooks/ai ──► Ed25519 verify (raw body) ──► read data.payload
```

The `conversation_id` returned by `/chat` is sent back on the next turn so the
assistant keeps full context. If the client omits it, the server mints a new one.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_ASSISTANT_ID` | `string` | `assistant-1234abcd` | **yes** | ID of the AI Assistant to chat with | [Portal](https://portal.telnyx.com/ai/assistants) · [CLI: `telnyx ai-assistants`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `o2dx...` (base64) | only for webhooks | Ed25519 public key for verifying inbound webhooks | [Portal - Keys & Credentials](https://portal.telnyx.com) |
| `PORT` | `number` | `3000` | no | Port the server listens on (defaults to `3000`) | - |

## Setup

> Requires Ruby 3.2.0 or newer - the Telnyx 5.x SDK does not support older Rubies.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-ruby
cp .env.example .env    # ← fill in your credentials
bundle install
ruby app.rb             # starts on http://localhost:3000
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

### `POST /chat`

Send a message to the configured AI Assistant and receive its reply. The assistant
is selected by the `AI_ASSISTANT_ID` environment variable, not the request body.
Pass back the `conversation_id` from a previous response to maintain context.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are your business hours?",
    "conversation_id": "conv-2f1c...optional-on-first-turn"
  }'
```

**Response:**

```json
{
  "assistant_id": "assistant-1234abcd",
  "conversation_id": "conv-2f1c8b7a-...",
  "user_message": "What are your business hours?",
  "assistant_response": "We are open Monday to Friday, 9am to 5pm."
}
```

### `POST /webhooks/ai`

Receive an inbound Telnyx webhook (e.g. conversation events). The handler verifies
the Telnyx **Ed25519** signature over the raw request body before reading any field
from `data.payload`. Returns `200 { "received": true }` on a valid signature.

### `GET /health`

Liveness check. Returns `200 { "status": "ok" }`.

```bash
curl http://localhost:3000/health
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error":"Invalid API key"}` (401) | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart - env vars load at boot |
| `{"error":"AI_ASSISTANT_ID environment variable not set"}` (500) | `AI_ASSISTANT_ID` is not present in the environment | Add `AI_ASSISTANT_ID` to `.env` and restart the server |
| `{"error":"Missing required field: 'message'"}` (400) | Request body has no `message` | Send a JSON body like `{"message":"Hello"}` with `Content-Type: application/json` |
| `{"error":"Message cannot be empty"}` (400) | `message` is blank or whitespace-only | Provide a `message` with at least one non-whitespace character |
| `{"error":"Rate limit exceeded. Please slow down."}` (429) | Too many requests for your account plan | Back off and retry after ~60 seconds; add exponential backoff in your client |
| `{"error":"Invalid signature"}` (401) on `/webhooks/ai` | `TELNYX_PUBLIC_KEY` does not match the account, or the body was altered/re-parsed before verification | Use the base64 Ed25519 public key from the Telnyx Portal; verify the raw body before parsing |
| `LoadError: cannot load such file -- standardwebhooks` | `require "telnyx"` transitively requires `standardwebhooks`, which the gem does not declare | Ensure the Gemfile includes `gem "standardwebhooks"` and run `bundle install` |
| `uninitialized constant Telnyx::Client` | The `telnyx` gem is not installed, or an old 3.x version resolved | Pin `gem "telnyx", "~> 5.131"` and run `bundle install` |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) - the Python / Flask version of this example
- [chat-with-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-nodejs/README.md) - the Node.js / Express version
- [create-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md) - create an AI Assistant to chat with
- [list-ai-assistants-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-python/README.md) - list assistants to find an `AI_ASSISTANT_ID`
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - send SMS with the Telnyx Ruby SDK

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Chat with an Assistant - API Reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [AI Pricing](https://telnyx.com/pricing/inference)
- [Telnyx Portal](https://portal.telnyx.com)
