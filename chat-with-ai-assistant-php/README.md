---
name: chat-with-ai-assistant
title: "Chat With a Telnyx AI Assistant (PHP)"
description: "Send a message to a Telnyx AI Assistant from a vanilla PHP front controller and return its reply, keeping conversation context across turns."
language: php
framework: vanilla
telnyx_products: [AI Assistants]
channel: [ai]
---

# Chat With a Telnyx AI Assistant (PHP)

Send a message to a Telnyx AI Assistant from a vanilla PHP front controller and return its reply, keeping conversation context across turns.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. AI Assistants run on that same network, so you can pair conversational AI with telephony and messaging through a single API and SDK instead of stitching together multiple vendors.

## Telnyx API Endpoints Used

- **Create a Conversation**: `POST /v2/ai/conversations` - [API reference](https://developers.telnyx.com/api-reference/assistants/create-a-conversation)
- **Chat with an Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` - [API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)

## Architecture

```
  POST /chat  { "message": "...", "conversation_id": "..." (optional) }
        │
        ▼
  ┌────────────────────────────────┐
  │ index.php (vanilla PHP router)  │
  └───────────────┬────────────────┘
                  │  no conversation_id? -> $client->ai->conversations->create()
                  │  $client->ai->assistants->chat(assistantID, content, conversationID)
                  ▼
  ┌────────────────────────────────┐
  │ Telnyx AI Assistant            │
  └───────────────┬────────────────┘
                  │
                  └──► { conversation_id, reply } (JSON)

  POST /webhooks  ──► $client->webhooks->unwrap(body, headers)  (Ed25519 verify)
                       └──► read fields from data.payload
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_ASSISTANT_ID` | `string` | `assistant-1234abcd` | **yes** | ID of the AI Assistant to chat with | [Portal](https://portal.telnyx.com/ai/assistants) · [CLI: `telnyx ai-assistants`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yf...base64...` | only for `/webhooks` | Base64 Ed25519 public key used to verify webhook signatures | [Portal](https://portal.telnyx.com) - Account > Keys & Credentials |
| `PORT` | `number` | `8080` | no | Port the PHP built-in server listens on | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-php
cp .env.example .env          # ← fill in your credentials
composer install
php -S localhost:8080 index.php   # serves on http://localhost:8080
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


> Requires PHP 8.1+ with the `sodium` extension (bundled in standard PHP 8 builds) for webhook signature verification.

## API Reference

### `POST /chat`

Send a message to the configured AI Assistant and receive its reply. The assistant is selected by the `TELNYX_ASSISTANT_ID` environment variable. Omit `conversation_id` on the first turn to start a new conversation; pass the returned id back on later turns to keep context.

```bash
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are your business hours?"}'
```

**Response `200`:**

```json
{
  "assistant_id": "assistant-1234abcd",
  "conversation_id": "conv-abcd1234",
  "user_message": "What are your business hours?",
  "reply": "We are open Monday to Friday, 9am to 5pm.",
  "timestamp": "2026-06-19T14:32:00+00:00"
}
```

### `GET /health`

Liveness check.

```bash
curl http://localhost:8080/health
```

**Response `200`:** `{"status": "ok"}`

### `POST /webhooks`

Receive and Ed25519-verify inbound Telnyx webhooks. Reads event fields from `data.payload`. Returns `401` if the signature is invalid.

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-php/API.md) for the full typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error":"Authentication failed. Check your TELNYX_API_KEY."}` (401) | `TELNYX_API_KEY` is missing or wrong. | Generate a key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`. Remove any quotes or trailing spaces. |
| `{"error":"TELNYX_ASSISTANT_ID is not configured."}` (500) | `TELNYX_ASSISTANT_ID` is not set in the environment. | Add `TELNYX_ASSISTANT_ID` to `.env` and restart the server. |
| `{"error":"Missing required field: 'message'."}` (400) | Request body has no non-empty `message`. | Send a JSON body like `{"message":"Hello"}` with `Content-Type: application/json`. |
| `{"error":"Rate limit exceeded. Please retry shortly."}` (429) | Account rate limit exceeded. | Back off ~60s and retry with exponential backoff. |
| `{"error":"Invalid webhook signature."}` (401) on `/webhooks` | `TELNYX_PUBLIC_KEY` is missing/wrong, or the timestamp is outside the replay window. | Set `TELNYX_PUBLIC_KEY` to your account's base64 Ed25519 public key and ensure server clock is accurate. |
| `Call to undefined function sodium_crypto_sign_verify_detached()` | PHP built without the `sodium` extension. | Install/enable `ext-sodium` (standard in PHP 8 builds). |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx ai-assistants list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [create-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-nodejs/README.md) - Create an AI Assistant to chat with
- [list-ai-assistants-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-nodejs/README.md) - List assistants to find a `TELNYX_ASSISTANT_ID`
- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) - The Python version of this example
- [chat-with-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-nodejs/README.md) - The Node.js version of this example

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Chat with an Assistant API Reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [AI Pricing](https://telnyx.com/pricing/inference)
