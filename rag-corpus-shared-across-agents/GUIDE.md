# RAG Corpus Shared Across Agents — Guide

This guide walks through the `rag-corpus-shared-across-agents` example — one
shared, embedded knowledge base on Telnyx Edge Compute queried by multiple AI
agent personalities, each answering in its own voice with cited sources. It
combines a `CorpusAgent` StatefulActor (chunking, embeddings, SQL vector
store, cosine search), the Cloud Storage bucket binding for document
ingestion, per-persona `PersonaAgent` actors with durable conversation
history, and the zero-credential Telnyx Inference binding for both embeddings
and chat.

## What you'll build

- A shared RAG corpus per corpus id — chunks and embedding vectors stored in
  per-actor SQL
- Document ingestion from a Cloud Storage bucket (`knowledge/…`) or via a
  direct REST upload
- Three agent personalities — support, sales, engineering — all reading the
  SAME corpus, each with its own durable conversation memory
- Grounded answers with cited sources and per-chunk similarity scores
- A demo page that seeds sample documents and lets you ask one question as
  three different personas

## Prerequisites

- Node.js 22.5+ (built-in SQLite backs the local SQL surface)
- A Telnyx account
  - **Deployed**: nothing to configure — inference and storage use
    pre-authenticated platform bindings
  - **Local dev**: a Telnyx API key ([create one](https://portal.telnyx.com/api-keys))
- The [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge-compute/quickstart)
  (`telnyx-edge`) for deployment
- (Optional, for bucket ingestion) A Telnyx Cloud Storage bucket with
  documents under `knowledge/`

## How it works

Three moving parts: the corpus actor, the persona actors, and the worker.

### 1. The corpus actor — one knowledge base

`CorpusAgent` is addressed as `env.CORPUS.idFromName(corpusId)`. The corpus id
is the actor name, so every caller that uses the same corpus id reaches the
same single-threaded, durable actor — the Durable Objects isolation model.
Its per-actor SQLite table is the vector store:

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,     -- "<doc>#<ord>"
  doc TEXT,                -- source document key
  ord INTEGER,             -- chunk position
  text TEXT,               -- chunk text
  embedding TEXT           -- JSON float array from the embeddings API
);
```

Ingestion (`ingest` / `ingestBucket`) chunks the text with
`CHUNK_SIZE`/`CHUNK_OVERLAP`, batches the chunks through
`TELNYX.ai.openai.embeddings.createEmbeddings`, and upserts rows. Re-ingesting
a document name replaces its rows, so updates are idempotent.

Retrieval (`search`) embeds the query, scans the corpus rows, and ranks by
cosine similarity in the actor. At sample scale this is instant; for large
corpora, swap in the managed `TELNYX.ai.embeddings.similaritySearch` bucket
API.

### 2. The persona actors — many personalities, one corpus

`PersonaAgent` is addressed as `env.PERSONAS.idFromName("<corpus>:<persona>")`.
Each (corpus, persona) pair is its own durable actor. The worker's `/ask`
route orchestrates the two hops (actor envs don't carry actor namespaces on
the platform, so an actor can't address another namespace directly):

1. `env.CORPUS.idFromName(corpusId).search(question, TOP_K)` — every persona
   reads the SAME corpus actor
2. `env.PERSONAS.idFromName(...).answer({ corpusId, persona, question, sources })`

Inside `answer()`, the persona actor builds its prompt from its persona
system prompt, its own conversation history (`this.messages.toOpenAI()`), and
the retrieved chunks as cited context, then completes with
`TELNYX.ai.openai.chat.createCompletion` and appends the Q/A pair to its
MessageLog. Because retrieval always targets the same corpus actor, every
personality answers from the same facts — only the voice differs. Because
each persona keeps its own MessageLog, follow-up questions keep per-persona
context.

### 3. The worker — REST over actors

`src/index.ts` routes `GET /` to the demo page and `/api/corpus/<id>/…` to the
actors: `documents`/`ingest-bucket`/`stats`/`reset` hit the corpus, `ask` hits
the persona actor. Both agent classes are exported from `index.ts` — the Edge
runtime discovers `CorpusAgent` and `PersonaAgent` from the `[[actors]]`
bindings in `telnyx.toml`.

## Walk through it locally

```bash
cp .env.example .env          # add TELNYX_API_KEY
npm install
npm run local:dev             # http://localhost:8787
```

On the demo page:

1. Click **Seed sample docs** — three short documents go through the same
   ingest path a bucket ingest would.
2. Ask "How do I rotate an API key?" as **Support Agent** — step-by-step,
   plain language.
3. Switch to **Solutions Engineer** and ask again — exact names and limits,
   same sources.
4. Click **Corpus stats** — document list and chunk count.

Prefer raw HTTP?

```bash
# Ingest directly
curl -X POST http://localhost:8787/api/corpus/product-docs/documents \
  -H "Content-Type: application/json" \
  -d '{"name": "knowledge/api-keys.txt", "text": "Rotate keys quarterly..."}'

# Ask as a persona
curl -X POST http://localhost:8787/api/corpus/product-docs/ask \
  -H "Content-Type: application/json" \
  -d '{"persona": "sales", "question": "Why should my team care about key rotation?"}'
```

## Deploy to the edge

```bash
npm run types   # regenerate typed bindings (telnyx-edge types)
npm run ship    # deploy (telnyx-edge ship)
```

In `telnyx.toml`, set `bucket_name` under
`[storage.cloudstorage.KNOWLEDGE]` to your Cloud Storage bucket, upload
documents under `knowledge/`, then call `POST /api/corpus/<id>/ingest-bucket`
once. Deployed functions hold no credentials: the `TELNYX` binding is
pre-authenticated by the platform.

## Adapting it

- **New personalities**: add an entry to `PERSONAS` in `src/types.ts` — id,
  label, system prompt. The demo page and `/api/personas` pick it up
  automatically.
- **Real vector search at scale**: replace `CorpusAgent.search` with
  `TELNYX.ai.embeddings.similaritySearch({ bucket_name, query, num_of_docs })`
  to let the platform rank chunks server-side.
- **Private documents**: bucket keys are your ACL boundary — separate corpora
  per tenant by using separate corpus ids.
