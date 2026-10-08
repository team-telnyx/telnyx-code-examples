# API Reference — `ai-gateway-tenant-meter`

Typed endpoint reference for the Telnyx Edge multi-tenant AI spend ledger. All routes are HTTP endpoints served by the Edge Worker entry point (`src/index.ts`). RPC methods on the `SpendLedger` actor are invoked internally via the `LEDGERS` actor namespace and are **not** directly exposed as HTTP routes.

When the `API_TOKEN` secret is configured, `POST /provision`, `GET /spend` and `POST /adjust` require `Authorization: Bearer <API_TOKEN>`; otherwise the routes are open (demo mode).

---

## `POST /provision`

Provisions a new tenant ledger: creates a Telnyx AI Gateway token group (with budget + guardrails) and a primary token key, then returns the gateway base URL and the tenant's credential.

### Request Body

| Field           | Type    | Required | Description                                                                 |
|-----------------|---------|----------|-----------------------------------------------------------------------------|
| `tenantId`      | string  | yes      | Unique tenant identifier (max 128 chars). Used as the token group name.     |
| `monthlyBudget` | number  | yes      | Monthly AI spend budget in USD. Must be > 0 and ≤ 10,000,000.               |

### Example Request

```bash
curl -X POST https://<your-worker-url>/provision \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "acme-corp",
    "monthlyBudget": 500.00
  }'
```

### Response Schema

**200 OK**

```json
{
  "gatewayBaseUrl": "https://llm.telnyx.com/v1",
  "tokenGroupId": "b1946ac9-24c2-41e4-977c-33b82260d5dc",
  "tokenKeyId": "6f2ba101-8955-48f0-b0d5-3cb9176d8d41",
  "tokenKey": "ltg_sk_...",
  "allowedModels": ["Kimi-K2.6", "Meta-Llama-3.1-8B-Instruct"],
  "alreadyProvisioned": false
}
```

| Field               | Type    | Description                                                                 |
|---------------------|---------|-----------------------------------------------------------------------------|
| `gatewayBaseUrl`    | string  | OpenAI-compatible inference base URL (constant: `https://llm.telnyx.com/v1`). |
| `tokenGroupId`      | string  | Telnyx AI Gateway token group ID (budget + guardrails scope).               |
| `tokenKeyId`        | string  | Token key ID (attribution + revocation handle).                             |
| `tokenKey`          | string  | The `ltg_sk_...` credential for the tenant assistant. Returned once per provision; stored in durable actor state. |
| `allowedModels`     | string[]| Model allowlist applied to the group.                                       |
| `alreadyProvisioned`| boolean | `true` when the ledger already existed (idempotent re-provision).           |

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Tenant ledger provisioned (or already existed).  |
| 400  | Invalid `tenantId` / `monthlyBudget`, or gateway validation error (e.g. `model_not_in_catalog`). |
| 401  | `API_TOKEN` set and no/wrong bearer token.       |
| 502  | AI Gateway unreachable or returned a 5xx.        |

---

## `GET /spend?tenantId=<tenantId>`

Returns the month-to-date spend view for a tenant: live gateway totals, by-model split, guardrail findings (codes only), alert history, and read-only status.

### Query Parameters

| Parameter  | Type   | Required | Description              |
|------------|--------|----------|--------------------------|
| `tenantId` | string | yes      | The tenant to report on. |

### Example Request

```bash
curl "https://<your-worker-url>/spend?tenantId=acme-corp"
```

### Response Schema

**200 OK**

```json
{
  "tenantId": "acme-corp",
  "monthToDate": 410.5,
  "budget": 500.0,
  "pct": 82,
  "byModel": {
    "Kimi-K2.6": { "spend": 410.5, "inputTokens": 912340, "outputTokens": 401277 }
  },
  "guardrails": {
    "blocked": 1,
    "flagged": 3,
    "findings": [
      { "day": "2026-10-05", "stage": "prompt", "outcome": "blocked", "detector": "secrets", "code": "stripe_key", "count": 1 }
    ]
  },
  "alerts": [{ "level": "80", "at": "2026-10-05T10:00:00Z" }],
  "readOnly": false,
  "budgetPeriod": { "startedAt": "2026-10-05T22:12:28Z", "resetsAt": "2026-11-04T22:12:28Z" },
  "lastRollupAt": "2026-10-05T23:00:00Z"
}
```

| Field             | Type     | Description                                                                 |
|-------------------|----------|-----------------------------------------------------------------------------|
| `monthToDate`     | number   | Spend across the current 30-day budget period (from gateway `usage/summary`). |
| `pct`             | number   | `monthToDate / budget`, capped at 100.                                       |
| `byModel`         | object   | Per-model spend + token split for the period.                                |
| `guardrails.findings` | array | Latest findings with `detector` codes and counts — never matched text.       |
| `readOnly`        | boolean  | `true` once the tenant crossed 100% in the current period (gateway enforces 403). |
| `budgetPeriod`    | object   | The gateway's 30-day budget window; the actor resets alert guards at `resetsAt`. |

### Status Codes

| Code | Description                                        |
|------|----------------------------------------------------|
| 200  | Spend view returned.                               |
| 400  | Missing `tenantId`, or the ledger is not provisioned. |
| 401  | `API_TOKEN` set and no/wrong bearer token.         |

---

## `POST /adjust`

Changes the tenant's token-group budget via `PATCH /v2/llm_token_gateway/token_groups/{id}` with the `If-Match` ETag precondition, and appends the change to the durable audit log.

### Request Body

| Field           | Type   | Required | Description                        |
|-----------------|--------|----------|------------------------------------|
| `tenantId`      | string | yes      | The tenant whose budget to change. |
| `monthlyBudget` | number | yes      | New monthly budget in USD (> 0).   |

### Example Request

```bash
curl -X POST https://<your-worker-url>/adjust \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "acme-corp", "monthlyBudget": 750.0 }'
```

### Response Schema

**200 OK**

```json
{
  "ok": true,
  "maxBudget": 750.0,
  "groupVersion": 2,
  "audit": [{ "at": "2026-10-05T23:10:00Z", "from": 500.0, "to": 750.0 }]
}
```

### Status Codes

| Code | Description                                            |
|------|--------------------------------------------------------|
| 200  | Budget updated on the gateway; audit entry recorded.   |
| 400  | Invalid budget, tenant not provisioned, or gateway validation error. |
| 412  | Gateway `precondition_failed` (stale ETag) — retry the call. |

---

## `GET /health`

### Response Schema

**200 OK**

```json
{ "status": "ok" }
```

---

## Internal RPC Methods (Actor-Level)

Invoked by the front door via the `LEDGERS` actor namespace (`env.LEDGERS.idFromName(tenantId)`). Each is decorated with `@rpc` and carries a stable schedule id for the rollup.

### `provision(tenantId, monthlyBudget)`

Creates the token group + token key, persists state, arms the hourly rollup (`this.every(3600, "rollup", undefined, { id: "hourly-rollup" })`). Idempotent: re-provisioning returns the existing ids and stored secret.

### `spendView(tenantId)`

Reads the live group (spend, `resets_at`, ETag version), syncs the budget period, pulls `usage/summary` and `guardrail_events`, persists findings into SQL, and returns the `SpendView`.

### `adjustBudget(monthlyBudget)`

ETag-preconditioned budget PATCH with a durable audit trail (last 50 changes kept in state).

### `rollup()`

The durable usage task. Runs once immediately at provision, then on the `ROLLUP_INTERVAL_SECONDS` cadence. Upserts per-day usage rows into `spend_days` (idempotent by `(tenant, day)`), records guardrail findings into `guardrail_events` (idempotent by gateway event id), fires the 80% / 100% alerts exactly once per budget period, flips `readOnly` at 100%, and re-arms itself.

---

## Environment Variables

| Variable | Kind | Default | Description |
|----------|------|---------|-------------|
| `TELNYX_API_KEY` | secret | — | Account API key for gateway management calls |
| `DEMO_MODE` | secret | `true` | `true` logs admin SMS instead of sending |
| `API_TOKEN` | secret | — | Optional bearer token guarding the HTTP routes |
| `ADMIN_SMS_FROM` | env var | — | SMS-capable Telnyx number for alerts |
| `ADMIN_SMS_TO` | env var | — | Ops phone number receiving alerts |
| `ALLOWED_MODELS` | env var | `Kimi-K2.6,Meta-Llama-3.1-8B-Instruct` | Model allowlist for new token groups |
| `ROLLUP_INTERVAL_SECONDS` | env var | `60` (code default `3600`) | Rollup cadence; production should use `3600` |
| `WARN_PCT` | env var | `80` | Warning-SMS threshold |
| `HARD_PCT` | env var | `100` | Read-only threshold (gateway enforces 403 here) |

---

## SQL Schema

Per-actor durable SQL (`this.ctx.storage.sql`), one database per tenant ledger.

### `spend_days`

| Column | Type | Notes |
|--------|------|-------|
| `tenant` | TEXT | Tenant id (part of PK) |
| `day` | TEXT | UTC `YYYY-MM-DD` (part of PK) |
| `spend` | REAL | USD spend for the day |
| `input_tokens` / `output_tokens` | INTEGER | Token counts for the day |
| `blocked` / `flagged` | INTEGER | Guardrail event counts for the day |

Upserted on every rollup — re-running a day overwrites, so the rollup is idempotent across restarts.

### `alerts`

| Column | Type | Notes |
|--------|------|-------|
| `tenant` | TEXT | Part of PK |
| `level` | TEXT | `80` or `100` (part of PK) |
| `at` | TEXT | ISO timestamp (part of PK) |

Append-only alert history; the once-per-period behavior is enforced in actor state (`alerted80` / `alerted100` flags), which reset when the gateway's `resets_at` rolls over.

### `guardrail_events`

| Column | Type | Notes |
|--------|------|-------|
| `event_id` | TEXT | Gateway event id (PK) — dedup across rollups |
| `tenant` | TEXT | Tenant id |
| `day` | TEXT | UTC day of the finding |
| `stage` | TEXT | `prompt` or `response` |
| `outcome` | TEXT | `blocked` or `flagged` |
| `detector` | TEXT | `secrets` or `dlp` |
| `code` | TEXT | Detector code (e.g. `stripe_key`, `credit_card`) — never matched text |
| `count` | INTEGER | Number of pattern matches |
