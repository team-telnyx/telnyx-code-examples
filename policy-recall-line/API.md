# API Reference — Policy Recall Line

This document is the typed contract for the HTTP surface of the `policy-recall-line` sample. It covers the two public routes (`/source`, `/ask`), the RPC surface (`audit`, `reindexNow`), and the internal task handlers. For setup, architecture, and deployment, see [README.md](./README.md). For a step-by-step walkthrough, see [GUIDE.md](./GUIDE.md).

All routes are served by a single durable actor instance per company. The fetch handler routes requests to the correct actor via `env.LIB.idFromName("company:<company>")`.

---

## Base URL

In local/demo mode, the actor is reached through the edge runtime's fetch handler. The public path prefix is:

```
/company/<company>
```

All routes below are relative to that prefix. For example, a request to `POST /ask` for company `acme` is:

```
POST /company/acme/ask
```

---

## POST /source

Registers a handbook URL for a company. The first registration for a company **births** the actor (via `env.LIB.idFromName("company:<company>")`) and starts the asynchronous embedding task.

### Request Body

| Field     | Type   | Required | Description                                                                 |
|-----------|--------|----------|-----------------------------------------------------------------------------|
| `company` | string | Yes      | Company slug. Used to derive the actor id: `company:<company>`.             |
| `url`     | string | No       | The handbook URL to crawl and embed. Falls back to the `SEED_HANDBOOK_URL` config. Should point to 2–5 pages of text. |

### Example Request

```bash
curl -X POST https://<deployment>/company/acme/source \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "url": "https://acme.example.com/handbook"
  }'
```

### Response — 201 Created

```json
{
  "slug": "company:acme",
  "taskId": "8f14e45f-ceea-4e5e-9b3e-2c1a0b5d7e9f",
  "status": "indexing"
}
```

### Status Codes

| Status | Description                                                                 |
|--------|-----------------------------------------------------------------------------|
| `201`  | Source registered; embedding task started.                                  |
| `400`  | Missing `company` in the request body, or invalid JSON.                     |
| `409`  | Source already registered for this company.                                 |
| `502`  | Embedding task failed to start (e.g., Telnyx API unreachable).              |

---

## `POST /ask`

Ask a policy question. The actor runs a similarity search over the embedded handbook, composes an answer via the LLM binding, and appends the Q&A to the `qa_log` ledger.

### Request Body

| Field      | Type   | Required | Description                                        |
|------------|--------|----------|----------------------------------------------------|
| `company`  | string | ✅       | The company slug (must match a registered source). |
| `question` | string | ✅       | The employee's policy question.                    |

### Example Request

```bash
curl -X POST http://<yourcompany>/company/acme/ask \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "question": "What is the PTO carry-over cap?"
  }'
```

### Response — 200 OK (hit)

When the top chunk distance is `<= SIMILARITY_FLOOR` (0.9), the answer is composed from the handbook excerpt:

```json
{
  "answer": "The PTO carry-over cap is 5 days per year. (Handbook, Section 4.2)",
  "topDistance": 0.31,
  "answered": true
}
```

### Response — 200 OK (no hit)

When every chunk distance is `> 0.9`, the no-hit reply is returned and the `qa_log` row is written with `answered=false`:

```json
{
  "answer": "I couldn't find a matching policy in the handbook. Please contact HR for clarification.",
  "topDistance": 0.94,
  "answered": false
}
```

### Status Codes

| Status | Description                                                                   |
|--------|-------------------------------------------------------------------------------|
| `200`  | Answer composed (hit or no-hit).                                              |
| `202`  | Source is still indexing; try again shortly.                                  |
| `400`  | Missing `company` or `question`, or invalid JSON.                             |
| `404`  | Unknown company — no source registered for this slug.                         |
| `500`  | Similarity search or LLM composition failed.                                  |

---

## RPC: `audit()`

Returns the last 20 `qa_log` rows for the actor. Callable via `agent.stub.audit()` from server-side code, or over HTTP through the worker pass-through route.

### Example Request

```bash
curl -X POST https://<deployment>/company/acme/rpc/audit
```

### Response — 200 OK

```json
{
  "qaLog": [
    {
      "id": 2,
      "asked_at": "2026-07-28T12:34:56Z",
      "question": "Can I expense a conference flight?",
      "answer": "Yes, conference flights are reimbursable up to $1,500. (Handbook of the 5.1)",
      "top_distance": 0.42,
      "source_slug": "company:acme",
      "answered": true
    },
    {
      "id": 1,
      "asked_at": "2026-07-28T12:30:00Z",
      "question": "What is the PTO carry-over cap?",
      "answer": "The PTO carry-over cap is 25 days per year. (Handbook of the 4.2)",
      "top_distance": 0.31,
      "source_slug": "company:acme",
      "answered": true
    }
  ]
}
```

---

## RPC: `reindexNow(slug)`

Triggers an immediate re-embed of the source's URL into the same bucket. A new `task_id` is generated and a fresh `poll:<taskId>` schedule is armed. Callable via `agent.stub.reindexNow("company:acme")` from server-side code, or over HTTP through the worker pass-through route.

### Example Request

```bash
curl -X POST https://<deployment>/company/acme/rpc/reindexNow \
  -H "Content-Type: application/json" \
  -d '{"slug": "company:acme"}'
```

### Response — 200 OK

```json
{
  "taskId": "c9f2b1d4-5a6e-4f8a-9b3c-2d1e0f4a5b6c"
}
```

### Status Codes

| Code | Description                                        |
|------|----------------------------------------------------|
| `200`| Re-embed started; new task ID returned.            |
| `404`| Unknown source slug.                               |
| `500`| Embedding task failed to start.                    |

---

## Internal Task Handlers

These are not HTTP routes — they are scheduled actor methods invoked by the runtime via `this[method](payload)`. Each is armed with a **stable id** so scheduling is an upsert (dedup + re-arm) and the task survives worker restarts.

### `onPollTask(payload)` — stable id `poll:<taskId>`

| Field    | Type   | Description                          |
|----------|--------|--------------------------------------|
| `taskId` | string | The embedding task ID to poll.       |
| `slug`   | string | The source slug (e.g., `company:acme`). |

Behavior:

- If the task status is `success`: flips source to `ready`, sets `lastIndexedAt`, and marks the `embed_tasks` row `finished_at` + `success`.
- If the task status is `failure`: increments `retries`. If `retries <= MAX_RETRIES` (3), schedules `retry:<slug>` after 600s. Otherwise marks the source `failed` and closes the `embed_tasks` row with `status='failed'`.
- If the task status is `queued` or `processing`: re-schedules the same stable id `poll:<taskId>` after 60s.

### `onRetryTask(payload)` — stable id `retry:<slug>`

| Field  | Type   | Description                          |
|--------|--------|--------------------------------------|
| `slug` | string | The source slug to retry.            |

Behavior: Re-starts the embed for the source's URL, stores the new `taskId`, and arms a fresh `poll:<taskId>` schedule.

### `onReindexTask(payload)` — stable id `reindex:<slug>`

| Field  | Type   | Description                          |
|--------|--------|--------------------------------------|
| `slug` | string | The source slug to re-index.         |

Behavior: Re-embeds the source's URL into the same bucket, stores the new `taskId`, sets status to `indexing`, resets `retries` to 0, and re-arms both the `poll:<taskId>` and `reindex:<slug>` schedules (24h cadence).

---

## Error Responses

All error responses share a consistent JSON shape:

```json
{
  "error": "Human-readable error message"
}
```

| Code | Common Cause                                      |
|------|---------------------------------------------------|
| `400`| Malformed JSON, missing required fields.           |
| `404`| Unknown company slug, unknown RPC method.          |
| `409`| Source already registered.                         |
| `500`| Telnyx API failure, LLM failure, or internal error.|

---

## Environment Variables

Config ships as `[[secrets]]` bindings in `telnyx.toml` and is read via `SECRETS.get()` with a plain env-var fallback (`readConfig` in `src/index.ts`) — the Edge runtime does not inject `[env_vars]` for actor projects.

| Variable             | Type   | Default                          | Description                                        |
|----------------------|--------|----------------------------------|----------------------------------------------------|
| `TELNYX_API_KEY`     | string | —                                | Telnyx API key (injected via secrets, never in code). |
| `SEED_HANDBOOK_URL`  | string | `https://acme.example.com/handbook` | Demo default handbook URL.                        |
| `BUCKET_NAME`        | string | `acme-handbook`                  | Pre-created bucket in the Telnyx Portal.           |
| `AI_MODEL`           | string | `moonshotai/Kimi-K3`             | Telnyx-hosted inference model; falls back to `zai-org/GLM-5.3-Flash` (no BYOK key needed). |

Constants (hardcoded in `src/index.ts`):

| Constant             | Value  | Description                                        |
|----------------------|--------|----------------------------------------------------|
| `SIMILARITY_FLOOR`   | `0.9`  | Max distance for a chunk to count as a hit.        |
| `POLL_INTERVAL_S`    | `60`   | Poll interval for embedding task status.           |
| `REINDEX_INTERVAL_S` | `86400`| 24h re-index cadence.                              |
| `RETRY_DELAY_S`      | `600`  | Delay before retrying a failed embed.              |
| `MAX_RETRIES`        | `3`    | Max retry attempts per source.                     |

---

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /v2/ai/embeddings/url` | Crawl a URL and embed it into a bucket. |
| `GET /v2/ai/embeddings/{task_id}` | Poll the status of an embedding task. |
| `POST /v2/ai/embeddings/similarity-search` | Search the embedded bucket for the top matching chunks. |
| `POST /v2/ai/chat/completions` (via `TELNYX` binding) | Compose the final answer from the top chunk. |
