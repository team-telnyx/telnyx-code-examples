---
name: rag-corpus-shared-across-agents
title: "RAG Corpus Shared Across Agents"
description: "Multiple AI agent personalities answering over ONE shared RAG corpus on Telnyx Edge Compute — a CorpusAgent embeds documents into per-actor SQL, and PersonaAgent actors retrieve, cite, and answer with their own voice through the zero-credential Telnyx Inference binding."
language: nodejs
framework: edge
telnyx_products: [Edge Compute, AI Inference, Cloud Storage]
---

# RAG Corpus Shared Across Agents

One embedded knowledge base, many personalities: a `CorpusAgent` StatefulActor chunks and embeds documents (from a Cloud Storage bucket or direct upload) into per-actor SQL, and any number of `PersonaAgent` actors — support, sales, engineering — retrieve from that same corpus and answer in their own voice with cited sources, all through the zero-credential Telnyx Inference binding.

## Why Telnyx

This sample demonstrates Telnyx's **AI Communications Infrastructure** — the same platform edge that keeps your communications stateful also stores your documents, runs your embeddings, and serves your agents. One `CorpusAgent` StatefulActor holds the shared RAG corpus in durable per-actor SQL, embeddings and chat completions run through the pre-authenticated `TELNYX` binding (`this.env.TELNYX.ai.openai.*`) — no API keys stored, rotated, or leaked anywhere in the deployed function — and the Cloud Storage bucket binding feeds documents in without a single credential in code. It is the stateful-isolation model of Cloudflare Durable Objects, composed with zero-credential RAG.

## Telnyx API Endpoints Used

- **AI Inference — embeddings (binding)**: `this.env.TELNYX.ai.openai.embeddings.createEmbeddings({ model, input })` — OpenAI-compatible embeddings for chunk and query vectors; [API reference](https://developers.telnyx.com/api-reference/embeddings/create-embeddings)
- **AI Inference — chat (binding)**: `this.env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` — persona-shaped answers grounded in retrieved context; [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Cloud Storage (binding)**: `env.KNOWLEDGE.list()` / `env.KNOWLEDGE.get()` — documents under `knowledge/` are read straight from a Telnyx Cloud Storage bucket; [product page](https://telnyx.com/products/storage)

All three run through platform bindings inside the actor, so no credential ever crosses the network boundary you control.

## Architecture

```
 knowledge/api-keys.txt ─┐
 knowledge/limits.txt  ──┤  Cloud Storage bucket (KNOWLEDGE binding)
 direct uploads ─────────┘
          │  ingest: chunk → createEmbeddings → per-actor SQL
          ▼
 ┌──────────────────────────────────────┐
 │  CorpusAgent (ONE actor per corpus)  │
 │  chunks(id, doc, ord, text, embed)   │
 │  search(query) → top-K by cosine     │
 └─────────────────┬────────────────────┘
                   │  env.CORPUS.idFromName(corpusId).search(...)
      ┌────────────┼────────────────┐
      ▼            ▼                ▼
 ┌──────────┐ ┌──────────┐  ┌──────────────┐
 │ Persona  │ │ Persona  │  │ Persona      │      each keeps its OWN
 │ support  │ │ sales    │  │ engineer     │      durable conversation
 │ actor    │ │ actor    │  │ actor        │      history (MessageLog)
 └────┬─────┘ └────┬─────┘  └──────┬───────┘
      └────────────┴───────────────┘
                   │  TELNYX.ai.openai.chat.createCompletion
                   ▼
        grounded answer + cited sources
```

**Flow:**
1. Documents land in the Cloud Storage bucket (`knowledge/…`) or arrive via `POST /api/corpus/<id>/documents`.
2. `CorpusAgent.ingest` chunks the text, batches embeddings through the `TELNYX` binding, and stores `chunks` rows in per-actor SQL.
3. A question hits the persona actor (`PERSONAS.idFromName("<corpus>:<persona>")`) — each persona is its own durable actor with its own conversation history.
4. The persona actor calls the corpus actor's `search()` — one corpus, shared by every persona — embeds the query, and ranks chunks by cosine similarity in the actor.
5. Retrieved chunks are injected as cited context; the persona system prompt shapes the answer's voice; the Q/A pair is appended to the persona's `MessageLog` so follow-ups keep context.

## Environment Variables

Set via `[env_vars]` in `telnyx.toml` (deployed) or `.env` (local dev):

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Chat model used by every persona | [Model catalog](https://developers.telnyx.com/docs/inference/models) |
| `EMBEDDING_MODEL` | `string` | `thenlper/gte-large` | no | Embedding model for chunks + queries | [Model catalog](https://developers.telnyx.com/docs/inference/models) |
| `KNOWLEDGE_PREFIX` | `string` | `knowledge/` | no | Bucket key prefix scanned by `ingest-bucket` | — |
| `TOP_K` | `string` | `4` | no | Chunks retrieved per question | — |
| `CHUNK_SIZE` | `string` | `800` | no | Max characters per chunk | — |
| `CHUNK_OVERLAP` | `string` | `150` | no | Characters carried between consecutive chunks | — |
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | local dev only | Telnyx API v2 key — **not needed deployed** (the `TELNYX` binding is pre-authenticated); only `scripts/local-dev.ts` uses it | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx-edge new-func --actor --name=rag-corpus-shared-across-agents
> telnyx-edge types
> telnyx-edge ship
> ```

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/rag-corpus-shared-across-agents
   ```

   <details><summary>Programmatic / CLI setup</summary>

   ```bash
   # Authenticate the Telnyx Edge CLI (stores your API key)
   telnyx-edge auth

   # Scaffold a new actor-backed edge function, then copy this folder's
   # telnyx.toml bindings into the generated config to assign func_id
   telnyx-edge new-func --actor --name=rag-corpus-shared-across-agents

   # Regenerate typed bindings after changing telnyx.toml
   telnyx-edge types
   ```

   </details>

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment (local dev only)**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Telnyx API key (used by the local harness for real inference calls; deployed functions use the zero-credential `TELNYX` binding instead):

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   AI_MODEL=meta-llama/Llama-3.3-70B-Instruct
   PORT=8787
   ```

4. **Run locally**

   ```bash
   npm run local:dev
   ```

   Open `http://localhost:8787`, click **Seed sample docs**, then ask the same question as Support, Sales, and Engineering — identical sources, three different voices. The local harness stands in the Cloud Storage bucket with a local `./knowledge/` directory: drop `.txt` files there and click through `POST /api/corpus/<id>/ingest-bucket`.

5. **Deploy to Telnyx Edge**

   ```bash
   npm run types   # regenerate typed bindings (telnyx-edge types)
   npm run ship    # deploy (telnyx-edge ship)
   ```

   Create a Cloud Storage bucket, upload documents under `knowledge/`, and put the bucket name in `telnyx.toml` under `[storage.cloudstorage.KNOWLEDGE]`. Deployed functions need **no API key** — inference and storage run through the pre-authenticated bindings.

## API Reference

### REST Endpoints

#### GET `/api/personas`

Lists the available persona ids for the ask route.

**Response:** `200 OK` → `{ "personas": [{ "id": "support", "label": "Support Agent" }, ...] }`

#### POST `/api/corpus/<corpus_id>/documents`

Ingest one document directly (chunked + embedded immediately).

**Request body:** `{ "name": "knowledge/api-keys.txt", "text": "…" }`
**Response:** `201 Created` → `{ "corpus_id": "…", "doc": "knowledge/api-keys.txt", "chunks": 2 }`

#### POST `/api/corpus/<corpus_id>/ingest-bucket`

Ingest every object under the configured `KNOWLEDGE_PREFIX` from the Cloud Storage bucket.

**Response:** `200 OK` → `{ "corpus_id": "…", "ingested": [{ "doc": "…", "chunks": 3 }, ...] }`

#### POST `/api/corpus/<corpus_id>/ask`

Ask a question as one of the personas. The persona actor retrieves from the shared corpus, answers in character with cited sources, and remembers the exchange.

**Request body:** `{ "persona": "support" | "sales" | "engineer", "question": "How do I rotate an API key?" }`
**Response:** `200 OK` →

```json
{
  "corpusId": "product-docs",
  "persona": "support",
  "question": "How do I rotate an API key?",
  "answer": "Rotate keys quarterly: create the new key first…",
  "sources": [{ "id": "knowledge/api-keys.txt#0", "doc": "knowledge/api-keys.txt", "ord": 0, "text": "…", "score": 0.42 }],
  "model": "meta-llama/Llama-3.3-70B-Instruct"
}
```

#### GET `/api/corpus/<corpus_id>/stats`

Corpus snapshot.

**Response:** `200 OK` → `{ "corpus_id": "…", "stats": { "docs": ["…"], "chunkCount": 5, "lastIngestedAt": 1756742400000 } }`

#### POST `/api/corpus/<corpus_id>/reset`

Drop every chunk. Documents must be re-ingested afterwards.

**Response:** `200 OK` → `{ "corpus_id": "…", "status": "reset" }`

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Answers ignore the knowledge base | Corpus is empty — nothing ingested | Check `GET /api/corpus/<id>/stats`; seed with the demo button or `POST /documents` |
| `ingest-bucket` returns an empty list | Bucket name/prefix mismatch | Set `bucket_name` in `[storage.cloudstorage.KNOWLEDGE]` and check `KNOWLEDGE_PREFIX` |
| Every persona gives the same answer style | Same persona id reused | Each persona id gets its own actor — use `support`, `sales`, `engineer` |
| Weak retrieval quality | Chunks too large or too small | Tune `CHUNK_SIZE` / `CHUNK_OVERLAP`; re-ingest after changing them |
| Vector search is slow on big corpora | Cosine ranking runs in-actor at sample scale | For large corpora use the managed `TELNYX.ai.embeddings.similaritySearch` bucket API |
| `telnyx-edge types` errors | `telnyx.toml` actor binding mismatch | Re-run `telnyx-edge new-func --actor` scaffold and merge bindings |

## Agent Discovery

This sample is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: One shared RAG knowledge base on Telnyx Edge Compute queried by multiple durable agent personalities with per-persona conversation memory and cited sources.
- **Runtime**: TypeScript on Telnyx Edge Compute. One `CorpusAgent extends Agent<Env, CorpusState>` per corpus id (chunking, embeddings, SQL vector store, cosine search) plus one `PersonaAgent` per (corpus, persona) pair (retrieval, persona-shaped completion, MessageLog history).
- **Primary APIs**: Telnyx Inference via the pre-authenticated `TELNYX` binding (`ai.openai.embeddings.createEmbeddings`, `ai.openai.chat.createCompletion`), the Cloud Storage bucket binding (`env.KNOWLEDGE.list/get`), per-actor SQL via `this.ctx.storage.sql`.
- **Entry point**: `src/index.ts` — worker fetch handler routing `GET /` and `/api/corpus/<id>/…` to the `CORPUS` and `PERSONAS` actor namespaces.
- **Zero-credential**: deployed functions hold no API key — inference and storage are authenticated by platform bindings; only `scripts/local-dev.ts` reads `TELNYX_API_KEY`.

## Related Examples

- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md) — Retrieval-augmented generation against the same inference API, managed from Python
- [Collaborative Document with AI Copilot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/collaborative-doc-ai-copilot/README.md) — The same StatefulActor + Agent SDK pattern applied to multiplayer editing
- [Persistent State Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — Durable StatefulActor on Edge with LangGraph and the same zero-credential inference binding

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) — functions, actors, and bindings
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api) — the pre-authenticated `TELNYX` client in your functions
- [Embeddings API reference](https://developers.telnyx.com/api-reference/embeddings/create-embeddings) — request/response schema for `createEmbeddings`
- [Inference API reference](https://developers.telnyx.com/api/inference/chat-completions) — chat completions request/response schema
- [Inference model catalog](https://developers.telnyx.com/docs/inference/models) — available `AI_MODEL` / `EMBEDDING_MODEL` values
- [Telnyx Cloud Storage](https://telnyx.com/products/storage) — buckets for the `KNOWLEDGE` binding
- [Telnyx pricing](https://telnyx.com/pricing) — inference and product pricing
