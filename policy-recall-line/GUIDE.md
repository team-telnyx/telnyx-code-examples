# Guide: Policy Recall Line — The Handbook Librarian

## Overview

This guide walks through the `policy-recall-line` sample, a Telnyx Edge application that implements a **durable, self-refreshing policy librarian** for a company handbook. The librarian is a single stateful actor per company that:

1. **Ingests** a handbook URL into a Telnyx Storage bucket and embeds it via the Telnyx Embeddings API
2. **Answers** employee questions by running similarity search over the embedded handbook and composing answers with an LLM
3. **Remembers** every Q&A in a SQL ledger
4. **Re-indexes** itself nightly (24-hour schedule) and survives crashes mid-index

The demo is deliberately simple: two HTTP routes, one bucket, two stable-id scheduled tasks. No vector database, no pipeline, no extra channel.

---

## Prerequisites

Before you begin, make sure you have:

- A **Telnyx account** with API access
- The **Telnyx Edge CLI** installed (`telnyx-edge`)
- **Node.js 18+** and `npm` installed
- A **handbook** you control (2–5 pages of policy text) hosted at a public URL — for the demo, use a small markdown or HTML page you can edit later to test re-indexing
- A **storage bucket** created in the Telnyx Portal (e.g., `acme-handbook`)

---

## Environment Setup

### 1. Clone and install

```bash
cd policy-recall-line
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# .env
TELNYX_API_KEY=your_telnyx_api_key_here
SEED_HANDBOOK_URL=https://acme.example.com/handbook   # your handbook URL
BUCKET_NAME=acme-handbook                              # your Telnyx storage bucket
```

> **Security note:** Never commit real API keys. The `.env.example` file contains placeholders only.

### 3. Authenticate the CLI

```bash
telnyx-edge auth api-key set $TELNYX_API_KEY
```

### 4. Generate types and deploy

```bash
telnyx-edge types   # regenerates telnyx-env.d.ts from telnyx.toml
telnyx-edge ship    # deploy to the edge
```

---

## How It Works — Step by Step

### 1. The Actor: `PolicyLine`

The core of the sample is the `PolicyLine` class in `src/index.ts`, which extends `Agent<Env, PolicyState>` from `@telnyx/edge-runtime`. This is a **stateful actor** — one durable entity per company.

**Key state** (`PolicyState`):
- `sources`: a map of company slugs → source records, each containing the URL, bucket, current embed task ID, status (`indexing` | `ready` | `failed`), last indexed timestamp, and retry count

**Key methods**:
- `fetch(req)`: the HTTP entry point — routes `/source` and `/ask` requests
- `handleRegisterSource(req)`: the "birth" of the librarian — registers a handbook URL for a company
- `handleAsk(req)`: the "reference desk" — answers a policy question
- `"poll:Timer"` task handler: polls the embed task status
- `"retry:Timer"` task handler: retries a failed embed
- `"reindex:Timer"` task handler: re-embeds the handbook after 24 hours
- `@rpc() audit()`: returns the last 20 Q&A log rows
- `@rpc() reindexNow(slug)`: triggers an immediate re-embed

### 2. The Fetch Handler — Routing to the Actor

The default export in `src/index.ts` is a fetch handler that:

1. Parses the URL path to extract the company slug (e.g., `/company/acme/...`)
2. Uses `env.LIB.idFromName("company:acme")` to get a stable actor ID for that company
3. Forwards the request to the actor's stub

This means **every company gets its own durable actor instance** — the librarian for `acme` is separate from the one for `globex`.

### 3. Registering a Source (The Birth)

When you `POST /source` with `{ "company": "acme", "url": "https://acme.example.com/handbook" }`:

1. The actor checks if a source already exists for `company:acme` — if so, returns `409 Conflict`
2. It calls `startEmbed(url, bucket)` which invokes the Telnyx Embeddings API:
   ```
   POST /v2/ai/embeddings/url
   { "url": "https://acme.example.com/handbook", "bucket_name": "acme-handbook" }
   ```
   This crawls the URL, chunks the content, and embeds it into the bucket. The API returns a `task_id` immediately — the actual embedding is **asynchronous**.
3. The actor stores the source with `status: "indexing"` and the `task_id`
4. It schedules two stable-id tasks:
   - `poll:<taskId>` — fires in 60 seconds to check the embed status
   - `reindex:<slug>` — fires in 86400 seconds (24 hours) to re-embed

### 4. Polling the Embed Task (Crash-Safe)

The `"poll:Timer"` handler is the crash-safe mechanism:

1. It calls `GET /v2/ai/embeddings/{task_id}` to get the status
2. If status is `"success"`:
   - Flips the source to `ready`
   - Sets `lastIndexedAt`
   - Appends a row to the `embed_tasks` SQL table
3. If status is `"failure"`:
   - Increments the retry counter
   - If retries ≤ 3, schedules a `retry:<slug>` task in 600 seconds
   - If retries > 3, marks the source as `failed`
4. If status is `queued` or `processing` → re-schedules the `poll:<taskId>` task for another 60 seconds

**Why this matters:** The embed task is asynchronous. A naive implementation would await-loop (fragile) or ignore status entirely. The stable `poll:<taskId>` schedule is the SDK-native fix — it survives worker restarts because the schedule is durable.

### 5. Answering Questions (The Reference Desk)

When you `POST /ask` with `{ "company": "acme", "question": "What is the PTO carry-over cap?" }`:

1. The actor checks the source exists and is `ready` — if still indexing, returns `202 Accepted`
2. It calls the similarity search API:
   ```
   POST /v2/ai/embeddings/similarity-search
   { "bucket_name": "acme-handbook", "query": "What is the PTO carry-over cap?", "num_of_docs": 3 }
   ```
   The response contains the top 3 chunks with their distances (lower = more similar).
3. If the top hit has `distance <= 0.9` (the `SIMILARITY_FLOOR`):
   - It composes an answer using the LLM binding:
     ```
     this.env.TELNYX.ai.openai.chat.createCompletion({
       model: "gpt-4o-mini",
       messages: [
         { role: "system", content: "You are the company librarian..." },
         { role: "user", content: `Question: ...\n\nHandbook excerpt: ...` }
       ]
     })
     ```
   - The answer is marked `answered: true`
4. If no hit is below the floor, it returns the no-hit reply and marks `answered: false`
5. Either way, it appends a row to the `qa_log` SQL table

**The ledger:** Every question asked is recorded — even the ones that don't get answered. This is the "reference desk that never forgets."

### 6. The 24-Hour Reindex (Nightly Re-shelving)

The `"reindex:Timer"` handler fires every 24 hours:

1. It calls `startEmbed` again with the same URL and bucket — this creates a **new** task ID
2. It updates the source's `taskId` and sets status back to `indexing`
3. It schedules a new `poll:<taskId>` task
4. It re-schedules the `reindex:<slug>` task for another 24 hours

This keeps the library fresh — if you edit a page in the handbook, the next reindex picks up the changes.

### 7. Interruption/Resume (Crash Safety)

The actor is **durable**. If the worker is killed mid-index:

- The source state (including the pending `taskId`) is persisted in the actor's storage
- The `poll:<taskId>` schedule is still pending — it fires when the actor wakes up
- The constructor re-arms the poll, the wake completes the index, and the next question is answered with the earlier Q&A log rows intact

**No context reconstruction needed** — the actor's state is the source of truth.

### 8. The RPC Surface

Two methods are exposed via `@rpc()`:

- `audit()` — returns the last 20 `qa_log` rows (the reference ledger)
- `reindexNow(slug)` — triggers an immediate re-embed (useful for testing or when a policy changes)

These are callable from outside the actor via `stub.audit()` or `stub.reindexNow("company:acme")`.

---

## Telnyx Primitives Used

| Primitive | How it's used |
|---|---|
| **Stateful Actor** (`Agent`) | One durable entity per company — owns the source map, the poll/re-index tasks, and the Q&A ledger |
| **Stable-id scheduling** | `this.schedule(60, "poll:Timer", { taskId, slug }, { id: "poll:" + taskId })` — upserted by stable ID, survives restarts |
| **Embeddings API** | `POST /v2/ai/embeddings/url` to crawl and embed; `POST /v2/ai/embeddings/similarity-search` to search |
| **LLM binding** | `this.env.TELNYX.ai.openai.chat.createCompletion()` — zero-credential answer composition |
| **SQL** | Two tables: `qa_log` (the reference ledger) and `embed_tasks` (the index history) |

---

## Demo Mode vs Live Mode

### Demo Mode (default)

The app runs in a **safe demo mode** by default:

- The `SEED_HANDBOOK_URL` defaults to `https://acme.example.com/handbook` — a placeholder
- The `BUCKET_NAME` defaults to `acme-handbook` — you must create this bucket in the Telnyx Portal
- Embed tasks are real (they hit the Telnyx API) but against a bucket you control
- No real charges for the demo itself — the embed API is free for small handbooks

### Live Mode

To use real data:

1. Set `SEED_HANDBOOK_URL` to your actual handbook URL
2. Set `BUCKET_NAME` to a bucket you own
3. Deploy and register your source:
   ```bash
   curl -X POST https://<your-app>.telnyx.app/company/acme/source \
     -H "Content-Type: application/json" \
     -d '{"company": "acme", "url": "https://your-handbook.com"}'
   ```

---

## API Reference

### `POST /company/<company>/source`

Register a handbook source for a company.

**Request body:**
```json
{
  "company": "acme",
  "url": "https://acme.example.com/handbook"
}
```

**Responses:**
- `201 Created` — source registered, embed task started
- `409 Conflict` — source already registered
- `400 Bad Request` — missing `company` or `url`

### `POST /company/<company>/ask`

Ask a policy question.

**Request body:**
```json
{
  "company": "acme",
  "question": "What is the PTO carry-over cap?"
}
```

**Responses:**
- `200 OK` — `{ "answer": "...", "topDistance": 0.31, "answered": true }`
- `202 Accepted` — source is still indexing
- `404 Not Found` — unknown company

### `@rpc audit()`

Returns the last 20 Q&A log rows.

### `@rpc reindexNow(slug)`

Triggers an immediate re-embed for the given slug.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `404 Unknown company` | Register the source first via `POST /source` |
| `202 Source is still indexing` | Wait for the embed task to complete (poll interval is 60s) |
| Embed task fails | Check the handbook URL is publicly accessible; check the bucket name |
| `409 Source already registered` | Use `reindexNow` to re-embed, or delete the source state |
| `TELNYX_API_KEY` not found | Set it in `.env` and run `telnyx-edge secrets add TELNYX_API_KEY "your_key"` |

---

## Next Steps

- **Explore the Agent SDK**: [docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- **Learn about Stateful Actors**: [edge-compute/stateful-actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- **Embeddings API**: [embeddings/embed-url-content](https://developers.telnyx.com/api-reference/embeddings/embed-url-content) and [embeddings/search-for-documents](https://developers.telnyx.com/api-reference/embeddings/search-for-documents)
- **Inference docs**: [inference/embeddings](https://developers.telnyx.com/docs/inference/embeddings)
- **Try the RPC surface**: Call `stub.audit()` to see the ledger, or `stub.reindexNow("company:acme")` to force a re-embed

---

## Why Telnyx

Telnyx is the **AI Communications Infrastructure** that makes this sample possible — the Embeddings API provides the RAG primitive (crawl, embed, search) in one service surface, the Agent SDK gives you durable stateful actors with stable scheduling and embedded SQL, and the zero-credential LLM binding means no API keys in your code. The librarian is load-bearing: remove the actor and you'd need to re-crawl per question or bolt cron onto an external database. Telnyx gives you the whole library in one platform.
