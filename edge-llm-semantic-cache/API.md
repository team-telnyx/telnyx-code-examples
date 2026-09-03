# API Reference — Edge-Deployed LLM Semantic Cache

This document describes the HTTP endpoints exposed by the Flask application defined in `app.py`.

---

## POST /chat

Semantic cache lookup with Inference fallback. Embeds the incoming prompt via Telnyx Inference, searches a KV-backed vector index using cosine similarity, and either returns a cached response or falls back to a full chat completion.

### Request Body

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| `prompt` | string | Yes      | The user prompt to embed, cache, and/or complete. Must be a non-empty string. |

### Example Request

```bash
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What are your support hours?"}'
```

### Response Schema

#### 200 OK — Cache Hit

Returns the cached response when a semantically similar entry is found in KV.

```json
{
  "cache_hit": true,
  "similarity": 0.9421,
  "response": "Our support team is available 24/7 via email and chat.",
  "latency_ms": 42,
  "model": "gpt-3.5-turbo"
}
```

#### 200 OK — Cache Miss

Returns a fresh chat completion when no similar cached entry is found. The new embedding and response are written back to KV.

```json
{
  "cache_hit": false,
  "similarity": 0.1203,
  "response": "You can reach our support team at any time through our help center.",
  "latency_ms": 847,
  "model": "gpt-3.5-turbo"
}
```

### Status Codes

| Status | Meaning                                      | Response Body                                      |
|--------|----------------------------------------------|----------------------------------------------------|
| 200    | Success — cache hit or miss                  | `{ cache_hit, similarity, response, latency_ms, model }` |
| 400    | Bad request — missing or invalid `prompt`    | `{ "error": "Request body must contain a 'prompt' field." }` or `{ "error": "'prompt' must be a non-empty string." }` |
| 500    | Internal server error — missing env vars or API failure | `{ "error": "<descriptive message>" }` |

---

## GET /health

Simple health check endpoint.

### Example Request

```bash
curl http://localhost:8080/health
```

### Response Schema

#### 200 OK

```json
{
  "status": "ok"
}
```

### Status Codes

| Status | Meaning         | Response Body            |
|--------|-----------------|--------------------------|
| 200    | Service healthy | `{ "status": "ok" }`     |

---

## Response Fields Reference

All `/chat` responses include the following fields:

| Field         | Type    | Description                                                                 |
|---------------|---------|-----------------------------------------------------------------------------|
| `cache_hit`   | boolean | `true` if the response was served from the KV cache; `false` if a fresh completion was generated. |
| `similarity`  | float   | Cosine similarity score between the prompt embedding and the best cached neighbor. Ranges from `0.0` to `1.0`. |
| `response`    | string  | The response text — either from cache or from a fresh Inference chat completion. |
| `latency_ms`  | integer | Total request processing time in milliseconds, including embedding, cache search, and (if needed) chat completion. |
| `model`       | string  | The chat model used for the response (from the `CHAT_MODEL` environment variable). |

---

## Environment Variables

The following environment variables control the behavior of the `/chat` endpoint:

| Variable               | Required | Default             | Description                                              |
|------------------------|----------|---------------------|----------------------------------------------------------|
| `TELNYX_API_KEY`       | Yes      | —                   | Telnyx API key for Inference (embeddings + chat).        |
| `KV_REST_URL`          | Yes      | —                   | REST URL of the KV store (e.g., Vercel KV / Upstash).    |
| `KV_REST_TOKEN`        | Yes      | —                   | Bearer token for KV store authentication.                |
| `SIMILARITY_THRESHOLD` | No       | `0.85`              | Minimum cosine similarity score for a cache hit.         |
| `CACHE_TTL_SECONDS`    | No       | `300`               | Time-to-live (in seconds) for cached entries in KV.      |
| `EMBEDDING_MODEL`      | No       | `text-embedding-3-small` | Telnyx Inference embedding model name.              |
| `CHAT_MODEL`           | No       | `gpt-3.5-turbo`     | Telnyx Inference chat completion model name.             |
| `KV_INDEX_KEY`         | No       | `semantic_cache_index` | KV key under which the vector index is stored.         |
| `PORT`                 | No       | `8080`              | Port on which the Flask app listens.                     |
