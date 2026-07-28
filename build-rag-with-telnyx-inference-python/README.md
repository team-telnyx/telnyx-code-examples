---
name: build-rag-with-telnyx-inference
title: "Build RAG with Telnyx Inference"
description: "Build a retrieval-augmented generation API with Telnyx embeddings and chat completions."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Build RAG with Telnyx Inference

Build a retrieval-augmented generation API with Telnyx embeddings and chat completions.

## Telnyx API Endpoints Used

- **Embeddings**: `POST /v2/ai/openai/embeddings` - create vectors for documents and questions
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  User question
        |
        v
  Embed question with Telnyx
        |
        v
  Compare against document embeddings
        |
        v
  Send retrieved context to Telnyx AI
        |
        v
  Grounded answer + source titles
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx chat model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `EMBEDDING_MODEL` | `string` | `thenlper/gte-large` | no | Telnyx embedding model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `HOST` | `string` | `127.0.0.1` | no | Local server host | - |
| `PORT` | `integer` | `5000` | no | Local server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-rag-with-telnyx-inference-python
cp .env.example .env
pip install -r requirements.txt
python app.py
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

### `POST /rag/ask`

Ask a question. The app retrieves relevant in-memory support docs and answers using only that context.

```bash
curl -X POST http://localhost:5000/rag/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Production signup broke after rotating an API key. Logs show 401 errors. What should we check first?"
  }'
```

**Response:**

```json
{
  "answer": "Check that production services are using the new active API key and that the key has the required permissions. Also verify no old key is cached in deployment secrets.",
  "model": "moonshotai/Kimi-K2.6",
  "embedding_model": "thenlper/gte-large",
  "sources": [
    {"title": "API Key Authentication", "score": 0.9123},
    {"title": "Verification Message Delivery", "score": 0.7811}
  ]
}
```

### `GET /documents`

Returns the sample knowledge base.

### `GET /health`

Returns service status, configured models, and document count.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing Telnyx API key | Verify `TELNYX_API_KEY` in `.env` |
| Slow first request | The app creates document embeddings lazily | First request may take longer; later requests reuse embeddings in memory |
| Weak answers | Sample knowledge base is too small | Add more documents or replace `DOCUMENTS` with your own content |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Run LLM Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)
- [AI Assistant Knowledge Base (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-knowledge-base-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
