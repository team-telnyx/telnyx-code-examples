---
name: run-llm-inference
title: "Run LLM Inference"
description: "Run large language model inference through the Telnyx Inference API using an OpenAI-compatible chat completions interface from Node.js. Works as both an HTTP server and a CLI tool."
language: nodejs
framework: express
telnyx_products: [Inference]
channel: [ai]
---

# Run LLM Inference

Run large language model inference through the Telnyx Inference API using an OpenAI-compatible chat completions interface from Node.js. Works as both an HTTP server and a CLI tool.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Inference runs on Telnyx-owned hardware co-located with the telephony network, so you get an OpenAI-compatible API, low-latency responses, and a single API key that also reaches voice, SMS, and SIP.

## Telnyx API Endpoints Used

- **Chat Completions**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/inference-embedding/post-chat-completions)

## Architecture

```
  HTTP request / CLI arg
        │
        ▼
  ┌────────────────────┐
  │  Express app        │
  │  /inference/chat    │
  │  /inference/ask     │
  └─────────┬──────────┘
            │  POST /v2/ai/chat/completions
            ▼
  ┌────────────────────┐
  │  Telnyx Inference   │
  └─────────┬──────────┘
            │
            └──► completion text
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key (used as the Bearer token) | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Default model slug. Falls back to `meta-llama/Llama-3.3-70B-Instruct` | [Inference docs](https://developers.telnyx.com/docs/inference) |
| `PORT` | `number` | `5000` | no | HTTP port for server mode. Defaults to `5000` | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/run-llm-inference-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
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


### CLI mode

Pass a question as command-line arguments to ask a single question and print the answer, without starting the server:

```bash
node server.js "What is the capital of France?"
```

To force server mode explicitly, pass `--serve`:

```bash
node server.js --serve
```

## API Reference

### `GET /health`

Liveness check. Returns the configured default model.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "model": "meta-llama/Llama-3.3-70B-Instruct"
}
```

### `POST /inference/chat`

Run a full chat completion. Pass a `messages` array (OpenAI-compatible) and optional generation parameters. Returns the raw Telnyx Inference response.

```bash
curl -X POST http://localhost:5000/inference/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Write a haiku about the ocean."}
    ],
    "max_tokens": 200,
    "temperature": 0.7
  }'
```

**Response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "meta-llama/Llama-3.3-70B-Instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Vast and endless blue\nWaves whisper to the shoreline\nMoonlight on the deep"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 23,
    "completion_tokens": 18,
    "total_tokens": 41
  }
}
```

### `POST /inference/ask`

Ask a single question and get just the answer text back. An optional `system_prompt` steers the model.

```bash
curl -X POST http://localhost:5000/inference/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the capital of France?",
    "system_prompt": "Answer in one word."
  }'
```

**Response:**

```json
{
  "answer": "Paris."
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection refused on port 5000 | App isn't running, or `PORT` differs | Run `node server.js` and confirm the port from the startup log. Set `PORT` in `.env` if 5000 is taken. |
| `401 Unauthorized` / `Inference API error: 401` | `TELNYX_API_KEY` is missing or invalid | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys). Telnyx keys start with `KEY`. |
| `Inference API error: 404` | The requested `model` slug is not available | Use `meta-llama/Llama-3.3-70B-Instruct` or check the model list in the [Inference docs](https://developers.telnyx.com/docs/inference). |
| `Request body must include 'messages' array` | `POST /inference/chat` called without `messages` | Include a non-empty `messages` array in the JSON body. |
| `Request body must include 'question'` | `POST /inference/ask` called without `question` | Include a `question` string in the JSON body. |
| Slow or timed-out responses | Large `max_tokens` or a large model | Lower `max_tokens` or pick a smaller model. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [build-voice-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) - Voice AI agent in Node.js
- [create-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-nodejs/README.md) - Create a managed AI Assistant
- [run-llm-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) - The same example in Python

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API reference](https://developers.telnyx.com/api/inference/inference-embedding/post-chat-completions)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Inference product page](https://telnyx.com/products/inference)
- [Inference pricing](https://telnyx.com/pricing/inference)
