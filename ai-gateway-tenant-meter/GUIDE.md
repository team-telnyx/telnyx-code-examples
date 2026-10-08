# AI Gateway Tenant Meter — Multi-Tenant AI Spend Ledger

A step-by-step tutorial for the `ai-gateway-tenant-meter` sample: a durable, per-tenant billing ledger that wraps the **Telnyx AI Gateway** with token-group budgets, secret guardrails, hourly rollup, and admin SMS alerts — all backed by a stateful actor that survives restarts.

---

## Prerequisites

- A Telnyx account with access to the **AI Gateway** (token groups, token keys, usage/summary, guardrail_events).
- A Telnyx phone number capable of sending SMS (for live-mode admin alerts).
- Node.js 22+ and `npm`.
- The `telnyx-edge` CLI installed and authenticated:

```bash
npm install -g @telnyx/edge-cli
telnyx-edge auth api-key set <your_api_key>
```

---

## Project Layout

```
ai-gateway-tenant-meter/
├── src/
│   └── index.ts          # GatewayClient, SpendLedger actor, HTTP entry point
├── smoke_test.ts         # Wire-contract smoke test (mocked fetch, no API key)
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor + binding declarations
├── .env.example
└── .gitignore
```

`src/index.ts` contains three layers:

1. **`GatewayClient`** — a thin REST wrapper over `https://api.telnyx.com/v2/llm_token_gateway`. It adds the mandatory `Idempotency-Key` header on every mutation, unwraps the `data` envelope, and maps API errors to typed `GatewayError`s.
2. **`SpendLedger extends Agent`** — one durable actor per tenant (`idFromName(tenantId)`). Owns provisioning, the hourly rollup, alerting, and the SQL ledger.
3. **The default export** — the HTTP front door (`/provision`, `/spend`, `/adjust`, `/health`), which dispatches to the right actor.

---

## Environment Setup

### 1. Install dependencies

```bash
cd ai-gateway-tenant-meter
npm install
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` file declares the actor binding, the `[telnyx]` API binding (zero-credential SMS), and the secrets:

```toml
name = "ai-gateway-tenant-meter"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "LEDGERS"
type    = "SpendLedger"

[telnyx]
binding = "TELNYX"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "DEMO_MODE"
name    = "DEMO_MODE"

[[secrets]]
binding = "API_TOKEN"
name    = "API_TOKEN"

[env_vars]
ADMIN_SMS_FROM = "+1555XXXXXXXX"
ADMIN_SMS_TO   = "+1555XXXXXXXX"
ALLOWED_MODELS = "Kimi-K2.6,Meta-Llama-3.1-8B-Instruct"
WARN_PCT       = "80"
HARD_PCT       = "100"
```

> There is no separate SQL binding — the ledger uses the Agent SDK's built-in per-actor SQL (`this.ctx.storage.sql`), so every tenant ledger gets its own durable database automatically.

### 3. Set secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
telnyx-edge secrets add DEMO_MODE "true"   # safe demo mode by default
telnyx-edge secrets add API_TOKEN "$(openssl rand -hex 24)"  # optional route guard
```

### 4. Generate type bindings

```bash
telnyx-edge types
```

This regenerates `telnyx-env.d.ts` from your `telnyx.toml` bindings so TypeScript knows about `env.LEDGERS`, `env.TELNYX`, `env.SECRETS`, etc.

---

## Demo Mode vs Live Mode

The sample runs in **safe demo mode** by default. When `DEMO_MODE` is `"true"` (or unset), the `sendAdminSms` method logs the SMS body to the console instead of calling the real Telnyx Messaging API:

```
[DEMO MODE] SMS to +1555XXXXXXXX: Tenant acme-corp is at 82% of its monthly AI budget ($410.50 of $500.00).
```

To switch to **live mode** (real SMS alerts):

```bash
telnyx-edge secrets add DEMO_MODE "false"
```

> The gateway management calls are always real (they meter and enforce budgets). Only the SMS is simulated in demo mode. Ensure `ADMIN_SMS_FROM` and `ADMIN_SMS_TO` are valid E.164 numbers before switching to live mode.

---

## How It Works — Step by Step

### 1. Bootstrapping a Tenant Ledger (`provision`)

**Code reference:** `provision()` method in `src/index.ts`.

When a tenant signs up, the HTTP entry point calls:

```typescript
const stub = env.LEDGERS.idFromName(tenantId);
const result = await stub.provision(tenantId, monthlyBudget);
```

`idFromName(tenantId)` deterministically maps a tenant ID to a single actor instance — one durable ledger per tenant. The `provision` RPC:

1. Validates `tenantId` (≤128 chars) and `monthlyBudget` (> 0).
2. Returns the existing ledger unchanged if already provisioned (idempotent).
3. Calls `POST /v2/llm_token_gateway/token_groups` with an `Idempotency-Key` header and:
   - `name`: the tenant ID
   - `allowed_models`: `ALLOWED_MODELS` (default: Telnyx-hosted models — no BYOK needed)
   - `max_budget`: the tenant's monthly budget
   - `budget_duration`: `"30d"` (a repeating 30-day budget period)
   - `guardrails`: secrets block (prompt + response), DLP `financial` flag (prompt + response), streaming `buffered`
4. Calls `POST /v2/llm_token_gateway/token_keys` with `{ name, token_group_id }` — the one-time secret is returned as `data.token` (`ltg_sk_...`).
5. Persists the group id, key id, the secret, and the gateway's `budget_started_at` / `resets_at` in durable actor state.
6. Initializes the SQL schema and arms the hourly rollup: `this.every(3600, "rollup", undefined, { id: "hourly-rollup" })`.

The tenant's assistant then calls the model at the constant inference base URL `https://llm.telnyx.com/v1` with the token key as its API key — every request is metered by the group and inspected by the guardrails.

### 2. Hourly Rollup (`rollup`)

**Code reference:** `rollup()` method in `src/index.ts`.

The rollup is a durable task dispatched by name. Because it re-arms itself with the stable id `hourly-rollup`, recurrence survives pod restarts:

1. Reads the token group (`GET /token_groups/{id}`) for the live `spend`, `resets_at`, and ETag `version`.
2. **Period rollover:** if the gateway's `resets_at` changed, the actor resets its once-per-period alert guards (`alerted80`, `alerted100`, `readOnly`) — so the next 30-day period starts clean.
3. Calls `GET /usage/summary?token_group_id=...&start_date=...&end_date=...` over the budget period (inclusive start, exclusive end, ≤31 days) and upserts every `data.by_day` row into `spend_days` with `ON CONFLICT(tenant, day) DO UPDATE` — **idempotent** across restarts.
4. Calls `GET /guardrail_events` and upserts findings into `guardrail_events` keyed by the gateway event `id`.
5. If spend crosses `WARN_PCT` (default 80%) and `alerted80` is false → one admin SMS + one `alerts` row, guard set in state.
6. If spend crosses `HARD_PCT` (default 100%) and `alerted100` is false → one admin SMS, `readOnly = true`, guard set in state.

### 3. Budget Enforcement at 100%

**Code reference:** `rollup()` method, `spendView()` method.

At 100% of the period budget, the Telnyx AI Gateway itself denies further inference requests with `403 budget_exceeded` — the gateway enforces, the actor doesn't need to. The actor's role is to:

- Flip the tenant view to read-only: `spendView` returns `readOnly: true` (persisted in durable state, so it survives restarts until the period resets).
- Notify the admin via SMS.

### 4. Guardrail Demo — Secret Detection and DLP Flagging

**Code reference:** `provision()` method (guardrails config), `rollup()` / `spendView()` (findings).

The provisioned policy blocks **credential-looking secrets** in both directions and **flags financial data**:

```json
{
  "secrets": { "prompt": "block", "response": "block" },
  "dlp": { "profiles": ["financial"], "prompt": "flag", "response": "flag" },
  "streaming": "buffered"
}
```

Verified live against the gateway:

- A prompt containing a Stripe-style key (`sk_live_...`) is rejected with **HTTP 400 `prompt_blocked`** before reaching the model (no spend, no spend event).
- A prompt containing a card number (`4111 1111 1111 1111`) succeeds with an `x-ltg-policy` header: `{"outcome":"flagged","findings":[{"detector":"dlp","code":"credit_card","count":1,"action":"flag"}]}` — the request is allowed but recorded.
- `GET /guardrail_events` returns findings with **codes and counts only — never the matched text**. The rollup persists them into `guardrail_events` (deduped by event id), and `spendView` surfaces them under `guardrails.findings`.

### 5. Reading the Ledger (`spendView`)

**Code reference:** `spendView()` method in `src/index.ts`.

The tenant dashboard calls:

```
GET /spend?tenantId=acme-corp
```

The ledger actor:

1. Syncs the budget period (rollover check).
2. Reads `data.totals` from `usage/summary` for the period window → `monthToDate`, `pct`.
3. Maps `data.by_model` into the by-model breakdown.
4. Pulls findings from the gateway and merges with the local `guardrail_events` history.
5. Returns `SpendView` with `monthToDate`, `pct`, `byModel`, `guardrails` (blocked/flagged/findings), `alerts`, `readOnly`, and the `budgetPeriod` window.

### 6. Restart Proof

**Code reference:** `rollup()` method, `provision()` method, durable state.

Kill the actor mid-month, then hit `GET /spend` again:

- The SQL rollup survives — `spend_days` rows are still there, and the next rollup only overwrites the current day.
- Alert history survives — the `alerts` table keeps every fired alert.
- No duplicate alerts — `alerted80` / `alerted100` in durable state are still `true`; the guards only reset when the gateway's `resets_at` moves into the next 30-day period.
- The recurring rollup re-arms itself with the stable `hourly-rollup` id, so an evicted actor resumes its schedule on the next activation.

### 7. Budget Changes with Preconditions (`adjustBudget`)

**Code reference:** `adjustBudget()` method in `src/index.ts`.

`POST /adjust` performs a `PATCH /v2/llm_token_gateway/token_groups/{id}` with the current `If-Match` version and a fresh `Idempotency-Key`. If another writer changed the group first, the gateway returns `412 precondition_failed` and the caller simply retries (the client re-reads the current version each call). Every successful change is appended to a durable audit log (last 50 entries) returned as `audit`.

---

## Running the Smoke Test

The smoke test exercises the wire contract against a mocked fetch — no API key or network needed:

```bash
npm run smoke
```

Expected output: `10/10 smoke tests passed`.

`npm run typecheck` validates the implementation against the real `@telnyx/edge-runtime` types.

---

## Deploying

```bash
telnyx-edge ship
```

Then verify:

```bash
curl -s https://<your-deployment>/health
```

---

## Seeding Demo Tenants

Seed two tenants — one under budget, one driven over:

```bash
curl -X POST https://<your-deployment>/provision \
  -H 'Content-Type: application/json' \
  -d '{"tenantId": "demo-under", "monthlyBudget": 100}'

curl -X POST https://<your-deployment>/provision \
  -H 'Content-Type: application/json' \
  -d '{"tenantId": "demo-over", "monthlyBudget": 0.00001}'
```

Then send two completions through `demo-over`'s token key (point an OpenAI-compatible client at `https://llm.telnyx.com/v1` with the returned `tokenKey`), and watch:

```bash
curl "https://<your-deployment>/spend?tenantId=demo-over"
```

The admin SMS fires exactly once per threshold, `readOnly` flips to `true`, and the next gateway call from the tenant returns `403 budget_exceeded`.

---

## Telnyx Primitives Used

| Primitive | Where |
|-----------|-------|
| AI Gateway token groups (`max_budget`, `budget_duration`, guardrails) | `provision()` |
| AI Gateway token keys (one-time `ltg_sk_...` secret) | `provision()` |
| AI Gateway `usage/summary` (`data.totals` / `by_day` / `by_model` / guardrail counts) | `rollup()`, `spendView()` |
| AI Gateway `guardrail_events` (codes only) | `rollup()`, `spendView()` |
| AI Gateway `PATCH /token_groups/{id}` with ETag preconditions | `adjustBudget()` |
| Agent SDK durable actors (`Agent`, `idFromName`, `@rpc`) | `SpendLedger` |
| Agent SDK durable timers (`this.every()` with a stable id) | `armRollup()` |
| Agent SDK per-actor SQL (`this.ctx.storage.sql`) | `spend_days`, `alerts`, `guardrail_events` |
| Agent SDK merge-patch state (`getState` / `setState`) | alert guards, period rollover |
| `[telnyx]` binding messaging (`messages.send`) | admin SMS |

---

## Next Steps

- Wire a real tenant dashboard: point it at `GET /spend` and render `pct`, `byModel`, and findings.
- Add per-tenant Webhooks from a messaging profile to receive SMS delivery receipts.
- Extend `GUARDRAILS_POLICY` with additional DLP profiles (`government_id`, `contact`) per tenant policy.
- Replace the shared `API_TOKEN` with your production identity provider.
