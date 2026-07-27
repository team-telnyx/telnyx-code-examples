---
name: semantic-search
title: "Semantic Search for Support Tickets"
description: "Semantic Search — index support tickets via Telnyx embeddings API and find similar issues by meaning, not keywords. Includes a bundled sample ticket dataset."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Semantic Search for Support Tickets

Semantic Search — index support tickets via Telnyx embeddings API and find similar issues by meaning, not keywords. Includes a bundled sample ticket dataset.

## Telnyx API Endpoints Used

- **AI Embeddings**: `POST /v2/ai/openai/embeddings` — [API reference](https://developers.telnyx.com/api/inference/create-embeddings)

## Architecture

```
  Support tickets
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  │ (embed + index)   │
  └────────┬─────────┘
           │
           ├──► Telnyx Embeddings API
           │
           ├──► In-memory vector store (numpy)
           │
           ▼
  Query ──► Embed ──► Cosine similarity ──► Top-k tickets
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `EMBEDDING_MODEL` | `string` | `thenlper/gte-large` | no | Telnyx embedding model name | [Available models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/semantic-search-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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

### `POST /index`

Build the embedding index from the bundled sample tickets (or a provided list).

```bash
curl -X POST http://localhost:5000/index
```

**Response:**

```json
{
  "status": "indexed",
  "ticket_count": 15,
  "dimensions": 1024,
  "model": "thenlper/gte-large",
  "indexed_at": "2026-07-20T12:53:41Z"
}
```

### `POST /search`

Search for tickets by meaning. Returns the top-k most similar tickets with cosine similarity scores.

```bash
curl -X POST http://localhost:5000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I cannot send text messages to international phone numbers",
    "top_k": 3
  }'
```

**Response:**

```json
{
  "query": "I cannot send text messages to international phone numbers",
  "model": "thenlper/gte-large",
  "total_indexed": 15,
  "results": [
    {
      "ticket_id": "TKT-1002",
      "subject": "International SMS routing issue",
      "body": "Messages to Germany and France are not being delivered...",
      "category": "messaging",
      "priority": "high",
      "score": 0.9077
    },
    {
      "ticket_id": "TKT-1001",
      "subject": "SMS delivery failure to UK numbers",
      "body": "We are seeing SMS messages fail when sending to UK (+44) numbers...",
      "category": "messaging",
      "priority": "high",
      "score": 0.8724
    }
  ]
}
```

### `POST /tickets`

Add a new ticket to the existing index.

```bash
curl -X POST http://localhost:5000/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "New billing question",
    "body": "Customer is asking about prorated charges after plan change.",
    "category": "billing",
    "priority": "low"
  }'
```

**Response:**

```json
{
  "status": "added",
  "ticket_id": "TKT-1783718627"
}
```

### `GET /tickets/<id>`

Fetch a ticket by ID.

```bash
curl http://localhost:5000/tickets/TKT-1001
```

### `GET /stats`

Index statistics.

```bash
curl http://localhost:5000/stats
```

**Response:**

```json
{
  "ticket_count": 15,
  "dimensions": 1024,
  "model": "thenlper/gte-large",
  "indexed_at": "2026-07-20T12:53:41Z",
  "indexed": true
}
```

### `GET /health`

Returns service health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "tickets": 15,
  "indexed": true,
  "version": "1.0.0"
}
```

## Sample Dataset

The bundled `sample_tickets.json` contains 15 realistic support tickets across categories: messaging, voice, SIP, API, porting, fax, billing, and WebRTC. Each ticket has `id`, `subject`, `body`, `category`, `priority`, and `created_at`.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `index is empty` | Index not built | Call `POST /index` before searching |
| Slow indexing | Large batch of tickets | Reduce batch size in `get_embeddings()` or index fewer tickets |
| `numpy` not installed | Missing dependency | Run `pip install -r requirements.txt` |
| Low similarity scores | Wrong embedding model | Check available models at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/models) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [AI Changelog Generator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md)
- [AI Error Explainer (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/error-explainer-python/README.md)
- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Embeddings API Reference](https://developers.telnyx.com/api/inference/create-embeddings)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
