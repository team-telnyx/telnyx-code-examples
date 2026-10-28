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
| `AI_MODEL` | `string` | `moonshotai/Kimi-K3` | no | Telnyx-hosted inference model (default `moonshotai/Kimi-K3`; falls back to `zai-org/GLM-5.3-Flash` on error — no BYOK key needed) | [Telnyx Inference models](https://developers.telnyx.com/docs/ai/inference) |
| `BASE_URL` | `string` | `https://your-worker.telnyxcompute.com` | yes (for `npm run bootstrap`) | Deployed worker URL — printed by `telnyx-edge ship` | `telnyx-edge ship` output |
| `COMPANY` | `string` | `acme` | no | Company slug used by the bootstrap script | — |

> **Note:** the Edge runtime does **not** inject `[env_vars]` for actor projects. Config ships as `[[secrets]]` bindings in `telnyx.toml` and is read via `SECRETS.get()` with a plain env-var fallback (`readConfig` in `src/index.ts`). The `.env` file is for local tooling (including `npm run bootstrap`) only.

**Hardcoded demo constants** (in `src/index.ts`):

| Constant | Value | Description |
|----------|-------|-------------|
| `SIMILARITY_FLOOR` | `0.9` | A chunk with distance ≤ 0.9 counts as a hit |
| `POLL_INTERVAL_S` | `60` | Stable `poll:<taskId>` task cadence (seconds) |
| `REINDEX_INTERVAL_S` | `86400` | Stable `reindex:<slug>` cadence — the nightly re-shelving |
| `RETRY_DELAY_S` | `600` | Delay before a failed embed is retried |
| `MAX_RETRIES` | `3` | Max retry attempts per source before it is marked `failed` |

> **Agent / CLI access** — all of the above can be provisioned from the CLI/agent without the portal:
>
> ```bash
> telnyx auth set-key KEY…                                        # human CLI auth (or TELNYX_API_KEY env var for agents)
> telnyx storage buckets create acme-handbook                     # create the handbook bucket
> telnyx-edge new-func --actor -l ts -n policy-recall-line        # register the actor function
> telnyx-edge secrets add SEED_HANDBOOK_URL "https://…"           # your 2-5 page handbook
> telnyx-edge secrets add BUCKET_NAME acme-handbook               # bucket created above
> telnyx-edge secrets add AI_MODEL moonshotai/Kimi-K3               # Telnyx-hosted inference model (fallback: zai-org/GLM-5.3-Flash)
> telnyx-edge types && telnyx-edge ship                           # generate types and deploy
> ```

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

4. **Create the bucket** in the Telnyx Portal (e.g., `acme-handbook`) and set `SEED_HANDBOOK_URL` to a small handbook you control (2–5 pages).

5. **Authenticate the Telnyx Edge CLI**

   ```bash
   telnyx-edge auth api-key set "$TELNYX_API_KEY"
   ```

6. **Generate types and deploy**

   ```bash
   telnyx-edge types
   telnyx-edge ship
   ```

7. **Bootstrap the librarian** — register the seed handbook source. The first registration births the actor, shelves the source with status `indexing`, and arms the stable poll/reindex tasks.

   ```bash
   # Set BASE_URL in .env to your deployed worker URL first
   npm run bootstrap
   ```

8. **Ask a policy question** once the index is ready (the poll task flips the source to `ready`):

   ```bash
   curl -X POST https://<your-worker>/company/acme/ask \
     -H "Content-Type: application/json" \
     -d '{"company": "acme", "question": "What is the PTO carry-over cap?"}'
   ```

## API Reference

### `POST /company/{slug}/source`

Registers a handbook source for a company. The first registration births the librarian actor.

**Request body:**

```json
{
  "company": "acme",
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
  "company": "acme",
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

Returns the last 20 Q&A ledger rows. Invoked via `agent.stub.audit()`, or over HTTP through the worker pass-through:

```bash
curl -X POST https://<your-worker>/company/acme/rpc/audit
```

### `@rpc reindexNow(slug)`

Triggers an immediate re-embed of the handbook for a given company slug. Invoked via `agent.stub.reindexNow("company:acme")`, or over HTTP through the worker pass-through:

```bash
curl -X POST https://<your-worker>/company/acme/rpc/reindexNow \
  -H "Content-Type: application/json" \
  -d '{"slug": "company:acme"}'
```

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| `401 Unauthorized` on embed calls | Missing or invalid `TELNYX_API_KEY` | Verify the key in `.env` and re-run `telnyx-edge auth api-key set` |
| `404 Unknown company` on `/ask` | Source not registered yet | Call `POST /company/{slug}/source` first |
| `202 Source is still indexing` | Embed task still in progress | Wait for the poll task to complete, then retry |
| Embed task fails repeatedly | Handbook URL unreachable or too large | Verify the URL is public and the handbook is 2–5 pages |
| `telnyx-edge ship` fails | Missing `telnyx.toml` or invalid bindings | Run `telnyx-edge types` to regenerate types and verify `telnyx.toml` |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [semantic-search-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/semantic-search-python/README.md) — the stateless sibling: similarity search over support tickets with no durable actor, no re-index, no ledger
- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — durable entity agent per phone number (StatefulActors deep-dive)
- [shipment-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/shipment-agent/README.md) — the actor IS the package: push-only status notifications across carriers
- [order-status-self-service](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/order-status-self-service/README.md) — per-customer durable agent answering questions from per-actor SQL + message history

## Resources

- [Telnyx Dev Docs](https://developers.telnyx.com)
- [Embeddings API Reference](https://developers.telnyx.com/api-reference/embeddings/embed-url-content)
- [Agent SDK Docs](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors Docs](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Product Page](https://telnyx.com)
- [Pricing](https://telnyx.com/pricing)
