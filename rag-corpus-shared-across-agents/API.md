# API Reference

Complete endpoint reference for the shared RAG corpus with multi-persona agents (Telnyx Edge Compute + Agent SDK).

## Base URL

```
https://<your-function>.telnyxcompute.com
```

Locally: `http://localhost:8787`

## HTTP Endpoints

### `GET /`

Serves the demo page: pick a persona, ask a question, see the grounded answer with cited sources; seed sample documents; inspect corpus stats.

---

### `GET /api/personas`

Lists the available persona ids.

**Response:** `200 OK`

```json
{
  "personas": [
    { "id": "support", "label": "Support Agent" },
    { "id": "sales", "label": "Sales Engineer" },
    { "id": "engineer", "label": "Solutions Engineer" }
  ]
}
```

---

### `POST /api/corpus/<corpus_id>/documents`

Ingest one document: chunk → embed → store in the corpus actor's SQL.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | No | Document key (defaults to `untitled`; re-ingesting the same name replaces the previous chunks) |
| `text` | `string` | Yes | Document text |

**Example request:**

```bash
curl -X POST http://localhost:8787/api/corpus/product-docs/documents \
  -H "Content-Type: application/json" \
  -d '{"name": "knowledge/edge-compute.txt", "text": "Edge Compute runs your code at the edge location closest to the caller..."}'
```

**Response:** `201 Created`

```json
{
  "corpus_id": "product-docs",
  "doc": "knowledge/edge-compute.txt",
  "chunks": 2
}
```

---

### `POST /api/corpus/<corpus_id>/ingest-bucket`

Ingest every object under the configured `KNOWLEDGE_PREFIX` from the Cloud Storage bucket binding.

**Response:** `200 OK`

```json
{
  "corpus_id": "product-docs",
  "ingested": [
    { "doc": "knowledge/edge-compute.txt", "chunks": 2 },
    { "doc": "knowledge/rate-limits.txt", "chunks": 1 }
  ]
}
```

---

### `POST /api/corpus/<corpus_id>/ask`

Ask a question as one of the personas. The worker retrieves top-K chunks from the shared corpus actor, then the persona actor (one durable actor per `corpus:persona` pair) answers in character over those sources and remembers the exchange.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `persona` | `string` | No | One of the ids from `GET /api/personas` (defaults to `support`; unknown ids fall back to `support`) |
| `question` | `string` | Yes | The question |

**Example request:**

```bash
curl -X POST http://localhost:8787/api/corpus/product-docs/ask \
  -H "Content-Type: application/json" \
  -d '{"persona": "engineer", "question": "How do I deploy an edge function?"}'
```

**Response:** `200 OK`

```json
{
  "corpusId": "product-docs",
  "persona": "engineer",
  "question": "How do I deploy an edge function?",
  "answer": "Deploy with the Edge CLI: scaffold with telnyx-edge new-func, merge your bindings into telnyx.toml, then ship with telnyx-edge ship...",
  "sources": [
    {
      "id": "knowledge/edge-compute.txt#0",
      "doc": "knowledge/edge-compute.txt",
      "ord": 0,
      "text": "Functions deploy with the Edge CLI command telnyx-edge ship...",
      "score": 0.4212
    }
  ],
  "model": "meta-llama/Llama-3.3-70B-Instruct"
}
```

**Errors:** `400 Bad Request` → `{ "error": "question is required" }`

---

### `GET /api/corpus/<corpus_id>/stats`

Corpus snapshot: ingested documents, chunk count, last ingest timestamp.

**Response:** `200 OK`

```json
{
  "corpus_id": "product-docs",
  "stats": {
    "docs": ["knowledge/edge-compute.txt", "knowledge/inference.txt"],
    "chunkCount": 3,
    "lastIngestedAt": 1756742400000
  }
}
```

---

### `POST /api/corpus/<corpus_id>/reset`

Drop every chunk from the corpus. Documents must be re-ingested afterwards.

**Response:** `200 OK`

```json
{ "corpus_id": "product-docs", "status": "reset" }
```

---

## Actor RPC Surface

The REST routes are thin wrappers over typed calls on the two actor types. Any Edge client holding the namespace binding can call the same surface:

| Actor | Method | Signature | Description |
|-------|--------|-----------|-------------|
| `CorpusAgent` | `ingest` | `(name, text)` | Chunk + embed + upsert one document |
| `CorpusAgent` | `ingestBucket` | `()` | Ingest every object under the bucket prefix |
| `CorpusAgent` | `search` | `(query, limit?)` | Embed query, return top-K chunks by cosine score |
| `CorpusAgent` | `stats` | `()` | Corpus snapshot |
| `CorpusAgent` | `reset` | `()` | Drop every chunk |
| `PersonaAgent` | `answer` | `({ corpusId, persona, question, sources })` | Persona-shaped grounded answer over the worker-retrieved sources |
| `PersonaAgent` | `transcript` | `()` | Persona conversation snapshot |

Actor addressing: `env.CORPUS.idFromName(corpusId)` for the shared store, `env.PERSONAS.idFromName("<corpus>:<persona>")` for each personality.

## Underlying Telnyx APIs

| Call | Binding | Purpose |
|------|---------|---------|
| `ai.openai.embeddings.createEmbeddings({ model, input })` | `TELNYX` | Chunk + query vectors |
| `ai.openai.chat.createCompletion({ model, messages })` | `TELNYX` | Persona-shaped grounded answers |
| `KNOWLEDGE.list({ prefix })` / `KNOWLEDGE.get(key)` | Cloud Storage | Document source for bucket ingestion |
