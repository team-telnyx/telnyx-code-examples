---
name: edge-llm-semantic-cache
title: Edge-Deployed LLM Semantic Cache with KV
description: Flask app exposing POST /chat that embeds prompts via Telnyx Inference, runs cosine-similarity search against a KV-backed vector index, and falls back to a full chat completion on a similarity miss.
language: python
framework: flask
telnyx_products: [Inference, KV, Functions]
---

# Edge-Deployed LLM Semantic Cache with KV

A Flask app exposing `POST /chat` that embeds prompts via Telnyx Inference, runs cosine-similarity search against a KV-backed vector index, and falls back to a full chat completion on a similarity miss.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the building blocks developers need to embed intelligent, low-latency communication experiences directly into their applications. With Telnyx Inference, KV, and Functions, you can deploy edge-native AI workloads that cache, route, and respond at the speed of the network edge. This sample demonstrates how to cut repeat-prompt token costs and latency by serving semantically similar prompts from a KV-backed vector cache, falling back transparently to full LLM completions only when needed.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|----------|---------|---------|
| `POST /v1/inference/embeddings` | Inference | Generates embedding vectors for incoming prompts |
| `POST /v1/inference/chat/completions` | Inference | Full LLM chat completion fallback on cache miss |
| `GET /get/{key}` | KV | Retrieves the vector index and cached entries from the edge KV store |
| `POST /set/{key}` | KV | Writes updated vector index and cache entries back to KV with TTL |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client / HTTP Request                        │
│                        POST /chat {"prompt": "..."}                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Flask App (app.py)                               │
│                                                                     │
│  1. Validate env vars (TELNYX_API_KEY, KV_REST_URL, KV_REST_TOKEN)  │
│  2. Parse & validate prompt from JSON body                          │
│  3. get_embedding(prompt) → Telnyx Inference Embeddings API         │
│  4. search_cache(embedding) → cosine similarity vs KV index         │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  KV Store (REST-based, e.g. Upstash / Vercel KV)        │     │
│     │  Key: semantic_cache_index                               │     │
│     │  Value: JSON array of {prompt, embedding, response,      │     │
│     │          timestamp} entries                              │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                     │
│  IF best_score >= SIMILARITY_THRESHOLD:                             │
│     → Return cached response (cache_hit: true)                      │
│  ELSE:                                                              │
│     5. get_chat_completion(prompt) → Telnyx Inference Chat API      │
│     6. upsert_cache(prompt, embedding, response) → write to KV      │
│     → Return fresh response (cache_hit: false)                      │
│                                                                     │
│  Response: {cache_hit, similarity, response, latency_ms, model}     │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Flow:**

1. A client sends a `POST /chat` request with a `prompt`.
2. The Flask app validates environment variables and parses the prompt.
3. The prompt is embedded using the Telnyx Inference Embeddings API.
4. The embedding is compared against all stored embeddings in the KV vector index using cosine similarity.
5. If the best match scores ≥ `SIMILARITY_THRESHOLD`, the cached response is returned immediately (`cache_hit: true`).
6. On a miss, the full chat completion is fetched via Telnyx Inference, written back to KV with a TTL, and returned (`cache_hit: false`).

**KV Index Key Layout & Serialization:**

- **Key:** `semantic_cache_index` (configurable via `KV_INDEX_KEY`)
- **Value:** A JSON array of cache entry objects:
  ```json
  [
    {
      "prompt": "What is Telnyx?",
      "embedding": [0.12, -0.45, 0.78, ...],
      "response": "Telnyx is an AI communications infrastructure platform...",
      "timestamp": 1718000000.0
    }
  ]
  ```
- The entire index is stored as a single KV value and rewritten on each upsert. Each entry's TTL is governed by `CACHE_TTL_SECONDS`, which controls how long the index key persists in KV before automatic expiration.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CACHE_TTL_SECONDS` | `string` | `your_cache_ttl_seconds_here` | **yes** | CACHE_TTL_SECONDS | — |
| `CHAT_MODEL` | `string` | `your_chat_model_here` | **yes** | CHAT_MODEL | — |
| `EMBEDDING_MODEL` | `string` | `your_embedding_model_here` | **yes** | EMBEDDING_MODEL | — |
| `KV_INDEX_KEY` | `string` | `your_kv_index_key_here` | **yes** | KV_INDEX_KEY | — |
| `KV_REST_TOKEN` | `string` | `your_kv_rest_token_here` | **yes** | KV_REST_TOKEN | — |
| `KV_REST_URL` | `string` | `your_kv_rest_url_here` | **yes** | KV_REST_URL | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `SIMILARITY_THRESHOLD` | `string` | `your_similarity_threshold_here` | **yes** | SIMILARITY_THRESHOLD | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

**Defaults (when env vars are not set):**

| Variable | Default |
|----------|---------|
| `SIMILARITY_THRESHOLD` | `0.85` |
| `CACHE_TTL_SECONDS` | `300` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` |
| `CHAT_MODEL` | `gpt-3.5-turbo` |
| `KV_INDEX_KEY` | `semantic_cache_index` |
| `PORT` | `8080` |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-llm-semantic-cache

# 2. Create a virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Copy the example environment file and fill in your values
cp .env.example .env
# Edit .env with your Telnyx API key and KV store credentials

# 4. Run the Flask app
python app.py
# The server will start on http://0.0.0.0:8080
```

## API Reference

### `POST /chat`

Embeds the incoming prompt, searches the KV vector index for a semantically similar cached response, and returns either the cached result or a fresh Inference chat completion.

**Request:**

```json
{
  "prompt": "What is Telnyx used for?"
}
```

**Response (200 OK):**

```json
{
  "cache_hit": true,
  "similarity": 0.9234,
  "response": "Telnyx is an AI communications infrastructure platform...",
  "latency_ms": 42,
  "model": "gpt-3.5-turbo"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cache_hit` | `boolean` | `true` if a cached response was served, `false` if a fresh completion was generated |
| `similarity` | `float` | Cosine similarity score of the best match (0.0–1.0); `0.0` on a miss |
| `response` | `string` | The cached or freshly generated response text |
| `latency_ms` | `integer` | Total request processing time in milliseconds |
| `model` | `string` | The chat model used for the response |

**Error Responses:**

| Status | Body | Description |
|--------|------|-------------|
| `400` | `{"error": "Request body must contain a 'prompt' field."}` | Missing or invalid prompt |
| `500` | `{"error": "TELNYX_API_KEY environment variable is required."}` | Missing required environment variable |
| `500` | `{"error": "An internal error occurred. Please try again later."}` | Unhandled server error |

### `GET /health`

Simple health check endpoint.

**Response (200 OK):**

```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `TELNYX_API_KEY environment variable is required` | API key not set in `.env` | Copy `.env.example` to `.env` and add your Telnyx API key from the [Telnyx Portal](https://portal.telnyx.com) |
| `KV_REST_URL and KV_REST_TOKEN environment variables are required` | KV store credentials missing | Set up a KV store (e.g., Upstash, Vercel KV) and provide the REST URL and token in `.env` |
| `Embedding API call failed` | Invalid API key or model name | Verify `TELNYX_API_KEY` and `EMBEDDING_MODEL` values; check the [Inference docs](https://docs.telnyx.com) |
| `Chat completion API call failed` | Rate limiting (429) or model unavailable | Reduce request rate; verify `CHAT_MODEL` is supported; check [Telnyx status](https://status.telnyx.com) |
| `KV GET failed` / `KV SET failed` | Network or authentication issue with KV store | Verify `KV_REST_URL` and `KV_REST_TOKEN`; ensure the KV store is accessible from your network |
| Cache never hits | `SIMILARITY_THRESHOLD` too high | Lower the threshold (e.g., to `0.7`) in `.env` and restart the app |
| Stale cache entries | `CACHE_TTL_SECONDS` too long | Reduce the TTL value in `.env` to expire entries faster |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Organization](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [telnyx-code-examples/inference-chat-completion](https://github.com/team-telnyx/telnyx-code-examples/tree/main/inference-chat-completion) — Basic chat completion with Telnyx Inference
- [telnyx-code-examples/inference-embeddings](https://github.com/team-telnyx/telnyx-code-examples/tree/main/inference-embeddings) — Generating embeddings with Telnyx Inference
- [telnyx-code-examples/kv-vector-store](https://github.com/team-telnyx/telnyx-code-examples/tree/main/kv-vector-store) — Building a vector store with Telnyx KV
- [telnyx-code-examples/edge-functions-flask](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-functions-flask) — Deploying Flask on Telnyx Edge Functions

## Resources

- [Telnyx Inference Documentation](https://docs.telnyx.com/inference)
- [Telnyx Inference API Reference](https://developers.telnyx.com/api/inference)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Inference Product Page](https://telnyx.com/products/inference)
- [Telnyx Pricing](https://telnyx.com/pricing)
