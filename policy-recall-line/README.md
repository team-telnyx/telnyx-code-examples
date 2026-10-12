---
name: policy-recall-line
title: "Policy Recall Line — The Handbook Librarian"
description: "A durable, self-refreshing company librarian that answers policy questions from an embedded handbook and keeps a permanent Q&A ledger."
language: typescript
framework: edge
telnyx_products: [Embeddings, Storage, AI Inference, Edge Compute]
---

# Policy Recall Line — The Handbook Librarian

A stateful actor that embeds your company handbook, answers every policy question from the stacks, and files each Q&A in its ledger — a reference desk that never sleeps and re-shelves itself nightly.

## The Story

A regional hospital network with 2,400 employees across three campuses has a 40-page employee handbook that HR updates monthly. Every week, the HR team fields hundreds of repetitive questions — "What's the PTO carry-over cap?", "Can I expense a conference flight?", "How many sick days do I have left?" — and each answer takes a human 10 minutes to look up and reply. When the handbook changes, the old answers stay in circulation for weeks, causing compliance headaches and employee frustration.

The actor IS the company's librarian. It is born the moment the first handbook URL is registered, and it immediately begins shelving the handbook by embedding it into a Telnyx Storage bucket. It answers each employee question by searching its shelves, composing a concise answer from the most relevant excerpt, and writing the exchange into its ledger. When the worker process is killed mid-index, the librarian wakes up and finishes the job. When the handbook changes, the librarian re-shelves the affected pages overnight and answers the next question from the fresh copy. It remembers every question it has ever been asked, and it never forgets a policy. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that makes this librarian possible — a single platform that combines durable stateful actors, asynchronous embedding pipelines, similarity search, and LLM inference without managing a single server, database, or vector store.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/embeddings/url` | `POST` | Crawls a handbook URL and embeds it into a Telnyx bucket |
| `/v2/ai/embeddings/{task_id}` | `GET` | Polls the status of an embedding task |
| `/v2/ai/embeddings/similarity-search` | `POST` | Finds the most relevant handbook chunks for a question |
| `TELNYX.ai.openai.chat.createCompletion` | — | Composes a concise answer from the top matching chunk |

## Architecture

The librarian is a single durable actor per company. It owns the source map, the poll/re-index tasks, and the Q&A ledger. The fetch handler routes every request to the correct actor instance by company slug.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Fetch Handler                                │
│  POST /company/<slug>/source  →  env.LIB.idFromName("company:<slug>")│
│  POST /company/<slug>/ask    →  env.LIB.idFromName("company:<slug>") │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PolicyLine Actor (per company)                    │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │  Source Map  │    │  Task Scheduler  │    │  Q&A Ledger      │   │
│  │  (state)     │    │  poll:<taskId>   │    │  (SQL: qa_log)   │   │
│  │  url, bucket │    │  reindex:<slug>  │    │  (SQL: embed_tasks)│  │
│  │  status      │    │  retry:<slug>    │    │                  │   │
│  └──────┬───────┘    └────────┬─────────┘    └──────────────────┘   │
│         │                     │                                     │
│         ▼                     ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Telnyx Embeddings + Storage                     │   │
│  │  POST /v2/ai/embeddings/url  →  bucket "acme-handbook"       │   │
│  │  GET  /v2/ai/embeddings/{id}  →  status poll                 │   │
│  │  POST /v2/ai/embeddings/similarity-search → top chunks       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              LLM Binding (TELNYX.ai.openai)                  │   │
│  │  Compose answer from top chunk (distance ≤ 0.9)             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key | Telnyx Portal |
| `SEED_HANDBOOK_URL` | `string` | `https://acme.example.com/handbook` | no | Seed handbook URL (2–5 pages) | Your own handbook |
| `BUCKET_NAME` | `string` | `acme-handbook` | no | Pre-created bucket in Telnyx Portal | Telnyx Portal |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/policy-recall-line
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   # Edit .env and set your TELNYX_API_KEY
   ```

4. **Authenticate the Telnyx Edge CLI**

   ```bash
   telnyx-edge auth api-key set "$TELNYX_API_KEY"
   ```

5. **Generate types and deploy**

   ```bash
   telnyx-edge types
   telnyx-edge ship
   ```

6. **Create the bucket** in the Telnyx Portal (e.g., `acme-handbook`) and set `SEED_HANDBOOK_URL` to a small handbook you control (2–5 pages).

## API Reference

### `POST /company/{slug}/source`

Registers a handbook source for a company. The first registration births the librarian actor.

**Request body:**

```json
{
  "url": "https://acme.example.com/handbook"
}
```

**Response `201 Created`:**

```json
{
  "slug": "company:acme",
  "taskId": "task_123",
  "status": "indexing"
}
```

### `POST /company/{slug}/ask`

Asks a policy question. The librarian searches the embedded handbook and composes an answer.

**Request body:**

```json
{
  "question": "What is the PTO carry-over cap?"
}
```

**Response `200 OK` (hit):**

```json
{
  "answer": "The PTO carry-over cap is 5 days per year, as stated in the handbook.",
  "topDistance": 0.31,
  "answered": true
}
```

**Response `200 OK` (no hit):**

```json
{
  "answer": "I couldn't find a matching policy in the handbook. Please contact HR for clarification.",
  "topDistance": 0.95,
  "answered": false
}
```

### `@rpc audit()`

Returns the last 20 Q&A ledger rows.

### `@rpc reindexNow(slug)`

Triggers an immediate re-embed of the handbook for a given company slug.

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| `401 Unauthorized` on embed calls | Missing or invalid `TELNYX_API_KEY` | Verify the key in `.env` and re-run `telnyx-edge auth api-key set` |
| `404 Unknown company` on `/ask` | Source not registered yet | Call `POST /company/{slug}/source` first |
| `202 Source is still indexing` | Embed task still in progress | Wait for the poll task to complete, then retry |
| Embed task fails repeatedly | Handbook URL unreachable or too large | Verify the URL is public and the handbook is 2–5 pages |
| `telnyx-edge ship` fails | Missing `telnyx.toml` or invalid bindings | Run `telnyx-edge types` to regenerate types and verify `telnyx.toml` |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI](https://github.com/team-telnyx/ai)
- [llms.txt](https://developers.telnyx.com/llms.txt)

## Related Examples

- **Semantic Search for Support Tickets** — a stateless script that searches embedded support docs without a durable actor or ledger.
- **Call Center Agent** — a stateful agent that handles inbound calls with Call Control and AI inference.
- **SMS Auto-Responder** — a stateless webhook that replies to inbound SMS with a fixed message.

## Resources

- [Telnyx Dev Docs](https://developers.telnyx.com)
- [Embeddings API Reference](https://developers.telnyx.com/api-reference/embeddings/embed-url-content)
- [Agent SDK Docs](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors Docs](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Product Page](https://telnyx.com)
- [Pricing](https://telnyx.com/pricing)
