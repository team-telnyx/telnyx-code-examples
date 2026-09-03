# Edge-Deployed LLM Semantic Cache with KV — Developer Guide

This guide walks you through how the `edge-llm-semantic-cache` Flask sample works, step by step. You'll learn how prompts are embedded, how a KV-backed vector index is searched with cosine similarity, and how cache misses fall back to a full Telnyx Inference chat completion with automatic write-back.

---

## Prerequisites

Before running this sample, you need:

1. **Python 3.9+** — the sample uses type hints and `urllib.request` from the standard library.
2. **A Telnyx API key** — sign up at [telnyx.com](https://telnyx.com) and create an API key with Inference permissions.
3. **A KV-compatible REST store** — the sample uses a Redis-compatible REST API (e.g., Vercel KV, Upstash Redis). You need a REST URL and bearer token.
4. **`pip`** — to install Python dependencies.

---

## Environment Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd edge-llm-semantic-cache
pip install -r requirements.txt
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
KV_REST_URL=https://your-kv-instance.upstash.io
KV_REST_TOKEN=your_kv_token_here
SIMILARITY_THRESHOLD=0.85
CACHE_TTL_SECONDS=300
EMBEDDING_MODEL=text-embedding-3-small
CHAT_MODEL=gpt-3.5-turbo
KV_INDEX_KEY=semantic_cache_index
PORT=8080
```

> **Note:** The `.env.example` file contains placeholder values only. Never commit real credentials.

### 3. Validate configuration

The app validates required environment variables at startup via `_validate_env()`. If `TELNYX_API_KEY` or KV credentials are missing, the `/chat` endpoint returns a clear `500` error with an actionable message — never an unhandled stack trace.

---

## Running the App

### Local development

```bash
python app.py
```

The Flask server starts on `http://0.0.0.0:8080`.

### Endpoints

| Method | Path       | Description                                      |
|--------|------------|--------------------------------------------------|
| POST   | `/chat`    | Semantic cache lookup with Inference fallback    |
| GET    | `/health`  | Simple health check                              |

---

## How It Works — Step by Step

### Step 1: Configuration & Validation

The app reads all configuration from environment variables at module load time:

- `TELNYX_API_KEY` — authenticates all Telnyx Inference API calls.
- `KV_REST_URL` / `KV_REST_TOKEN` — authenticate against the REST-based KV store.
- `SIMILARITY_THRESHOLD` (default `0.85`) — cosine similarity score above which a cached response is considered a match.
- `CACHE_TTL_SECONDS` (default `300`) — time-to-live for the KV index entry.
- `EMBEDDING_MODEL` / `CHAT_MODEL` — Telnyx Inference model identifiers.
- `KV_INDEX_KEY` (default `semantic_cache_index`) — the KV key under which the vector index is stored.

The `_validate_env()` function checks that required variables are present and returns a descriptive error string if any are missing. This is called at the top of the `/chat` handler before any processing begins.

### Step 2: KV Client (REST-based)

The app uses Python's built-in `urllib.request` to communicate with the KV store over HTTP REST endpoints:

- `_kv_get(key)` — performs a `GET` request to `{KV_REST_URL}/get/{key}` with a bearer token. Returns the raw string value or `None` on failure.
- `_kv_set(key, value, ttl)` — performs a `POST` request to `{KV_REST_URL}/set/{key}` with a JSON body containing `{"value": ..., "ex": ttl}`. Returns `True` on HTTP 200.

Both functions log exceptions via `app.logger.exception(...)` and return safe defaults (`None` / `False`) rather than raising.

### Step 3: Embeddings via Telnyx Inference

The `get_embedding(prompt)` function calls `telnyx.Embedding.create()` with the configured embedding model. It handles both SDK object-style responses and dictionary-style responses for compatibility. If the API call fails, the exception is logged and re-raised so the `/chat` handler can return a `500` error.

### Step 4: Chat Completion Fallback

The `get_chat_completion(prompt)` function calls `telnyx.ChatCompletion.create()` with the configured chat model. It sends a single user message and extracts the response text from `choices[0].message.content`. Like the embedding function, it handles both SDK object and dictionary response formats.

### Step 5: Cosine Similarity

The `cosine_similarity(vec_a, vec_b)` function computes the cosine of the angle between two embedding vectors:

```
cos(θ) = (A · B) / (||A|| × ||B||)
```

It validates that both vectors have the same dimension, computes the dot product, normalizes by the L2 norms, and returns `0.0` if either vector has zero magnitude.

### Step 6: KV Vector Index Operations

The vector index is stored as a JSON array in a single KV key (`KV_INDEX_KEY`). Each entry in the array has this structure:

```json
{
  "prompt": "What is the capital of France?",
  "embedding": [0.1, 0.2, ..., 0.768],
  "response": "The capital of France is Paris.",
  "timestamp": 1700000000.0
}
```

**Index key layout:** The entire index is serialized as a JSON string and stored under the key `semantic_cache_index` (configurable via `KV_INDEX_KEY`).

**Serialization format:** JSON array of objects. Each object contains the original prompt text, the full embedding vector (list of floats), the cached LLM response text, and a Unix timestamp.

Three operations manage the index:

- `load_index()` — fetches the JSON string from KV, parses it into a Python list. Returns `[]` if the key doesn't exist or the JSON is corrupted.
- `save_index(index)` — serializes the index list back to JSON and writes it to KV with the configured TTL.
- `search_cache(prompt_embedding)` — iterates over all entries in the index, computes cosine similarity against the query embedding, and returns the best-matching entry if its score meets or exceeds `SIMILARITY_THRESHOLD`. Returns `(None, best_score)` on a miss.
- `upsert_cache(prompt, prompt_embedding, response)` — checks for an exact prompt match (updates in place) or appends a new entry. Saves the updated index to KV.

### Step 7: The `/chat` Handler

The `chat()` function orchestrates the full flow:

1. **Validate environment** — returns `500` with a clear error if required env vars are missing.
2. **Parse request body** — expects JSON with a `prompt` field. Returns `400` if missing or empty.
3. **Embed the prompt** — calls `get_embedding()`. If this fails, returns `500`.
4. **Search the cache** — calls `search_cache()` with the embedding.
5. **Cache hit** — if a match is found above the threshold, returns immediately with `cache_hit: true`, the cached response, the similarity score, latency, and model name. **No chat completion API call is made.**
6. **Cache miss** — calls `get_chat_completion()` to get a fresh response, then calls `upsert_cache()` to write the prompt, embedding, and response back to KV.
7. **Return response** — always returns structured JSON:

```json
{
  "cache_hit": true,
  "similarity": 0.9234,
  "response": "The capital of France is Paris.",
  "latency_ms": 42,
  "model": "gpt-3.5-turbo"
}
```

### Step 8: Error Handling

- **Missing env vars** — `_validate_env()` returns a descriptive message; the handler returns `500` with `{"error": "..."}`.
- **Embedding API failure** — exception is logged and re-raised; handler catches it and returns `500`.
- **Chat completion API failure** — same pattern as above.
- **KV failures** — `_kv_get()` and `_kv_set()` log exceptions and return safe defaults. A KV read failure means the cache is treated as empty (miss); a KV write failure means the entry isn't cached but the response is still returned to the user.
- **Unhandled exceptions** — the outer `try/except` in `chat()` catches everything, logs it, and returns a generic `500` error message. No stack traces leak to the client.

---

## Testing

### Unit tests

```bash
npm test
```

Or with Python:

```bash
python -m pytest tests/cache.test.py -v
```

The unit tests cover:
- Cosine similarity math (identical vectors = 1.0, orthogonal vectors = 0.0, dimension mismatch raises).
- KV index upsert (new entry appended, existing prompt updated in place).
- KV index search (returns best match above threshold, returns `None` below threshold).

### Smoke test

```bash
python smoke_test.py
```

The smoke test:
1. Sends an exact-match prompt and verifies `cache_hit: false` (first call is always a miss).
2. Replays the same prompt and verifies `cache_hit: true` with similarity ≥ 0.99.
3. Sends a paraphrased near-duplicate prompt and verifies `cache_hit: true` with similarity ≥ 0.9.
4. Sends a completely different prompt and verifies `cache_hit: false`.

---

## Demo Mode vs Live Mode

This sample runs in **live mode** by default — it makes real API calls to Telnyx Inference and writes to a real KV store. There is no demo mode because the sample is designed to be safe by default:

- No real SMS messages are sent.
- No real phone calls are placed.
- No real charges are incurred beyond standard Inference API usage.
- The KV store is only used for caching; no customer data is persisted beyond the prompt/response pairs used for cache validation.

To switch to a **mock mode** for local testing without API calls, set:

```env
TELNYX_API_KEY=mock_key_for_local_testing
KV_REST_URL=http://localhost:8080/mock-kv
KV_REST_TOKEN=mock_token
```

And run the smoke test, which will exercise the full code path with mock responses.

---

## Response Schema

Every `/chat` response follows this schema:

| Field         | Type    | Description                                              |
|---------------|---------|----------------------------------------------------------|
| `cache_hit`   | boolean | `true` if a cached response was served, `false` otherwise |
| `similarity`  | float   | Cosine similarity score of the best match (0.0–1.0)       |
| `response`    | string  | The LLM-generated or cached response text                 |
| `latency_ms`  | integer | Total request processing time in milliseconds             |
| `model`       | string  | The Telnyx Inference model used for the response          |

---

## Next Steps

- **Deploy to production** — containerize with Docker and deploy behind a reverse proxy.
- **Add authentication** — protect the `/chat` endpoint with an API key or JWT.
- **Scale the index** — for large caches, consider sharding the index across multiple KV keys or using a dedicated vector database.
- **Add retry/backoff** — implement exponential backoff for 429/5xx responses from the Inference API.
- **Monitor costs** — log cache hit rates and token usage to measure savings over time.

### Useful Links

- [Telnyx Inference API Docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Edge Functions Docs](https://developers.telnyx.com/docs/edge)
- [Telnyx Python SDK Reference](https://developers.telnyx.com/docs/sdk/python)
- [KV Store Best Practices](https://developers.telnyx.com/docs/kv)
- [Semantic Caching Patterns](https://developers.telnyx.com/guides/semantic-caching)
