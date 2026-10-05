# AI Gateway Tenant Meter — Multi-Tenant AI Spend Ledger

A step-by-step tutorial for the `ai-gateway-tenant-meter` sample: a durable, per-tenant billing ledger that wraps the **Telnyx AI Gateway** with token-group budgets, secret guardrails, hourly rollup, and admin SMS alerts — all backed by a stateful actor that survives restarts.

---

## Prerequisites

- A Telnyx account with access to the **AI Gateway** (token groups, token keys, usage/summary, spend/events, guardrail_events).
- A Telnyx phone number capable of sending SMS (for live-mode admin alerts).
- Node.js 20+ and `npm` (or `pnpm`/`yarn`).
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
│   └── index.ts          # SpendLedger actor + HTTP entry point
├── smoke_test.ts         # Verifies classes/methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor + binding declarations
├── .env.example
└── .gitignore
```

The actor lives in `src/index.ts`. The HTTP entry point (the `default export`) dispatches `/provision` and `/spend` requests to the correct per-tenant ledger actor via `env.LEDGERS.idFromName(tenantId)`.

---

## Environment Setup

### 1. Install dependencies

```bash
cd ai-gateway-tenant-meter
npm install
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` file declares the actor binding, the `[telnyx]` API binding (zero-credential SMS), the SQL database binding, and the `TELNYX_API_KEY` secret:

```toml
name = "ai-gateway-tenant-meter"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "LEDGERS"
type    = "SpendLedger"

[telnyx]
binding = "TELNYX"

[storage.sqldb.SPEND_DB]
id = "<sqldb-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[env_vars]
ADMIN_SMS_FROM = "+1555XXXXXXXX"
ADMIN_SMS_TO   = "+1555XXXXXXXX"
DASHBOARD_ORIGIN = "https://dashboard.example.com"
ROLLUP_CRON    = "0 * * * *"
WARN_PCT       = "80"
HARD_PCT       = "100"
SPEND_LOOKBACK_DAYS = "31"
```

> Replace `<sqldb-uuid>` with a real SQL database namespace UUID from the Telnyx dashboard.

### 3. Set secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
telnyx-edge secrets add DEMO_MODE "true"   # safe demo mode by default
```

### 4. Generate type bindings

```bash
telnyx-edge types
```

This regenerates `telnyx-env.d.ts` from your `telnyx.toml` bindings so TypeScript knows about `env.LEDGERS`, `env.TELNYX`, `env.SPEND_DB`, etc.

---

## Demo Mode vs Live Mode

The sample runs in **safe demo mode** by default. When `DEMO_MODE` is set to `"true"` (or unset), the `sendAdminSms` method logs the SMS body to the console instead of calling the real Telnyx Messaging API:

```
[DEMO MODE] SMS to +1555XXXXXXXX: Tenant ACME at 82% of monthly AI budget (82.00 of 100.00).
```

To switch to **live mode** (real SMS alerts, real gateway calls):

```bash
telnyx-edge secrets add DEMO_MODE "false"
```

> In live mode, the actor still uses the real Telnyx AI Gateway management APIs and the real SMS API. Ensure `ADMIN_SMS_FROM` and `ADMIN_SMS_TO` are set to valid E.164 numbers.

---

## How It Works — Step by Step

### 1. Bootstrapping a Tenant Ledger (`provision`)

**Code reference:** `provision()` method in `src/index.ts`.

When a tenant signs up, the HTTP entry point calls:

```typescript
const ledger = env.LEDGERS.idFromName(body.tenantId);
const stub = env.LEDGERS.get(ledger);
const result = await stub.provision(body.tenantId, body.monthlyBudget);
```

`idFromName(tenantId)` deterministically maps a tenant ID to a single actor instance — one durable ledger per tenant. The `provision` RPC:

1. Validates `tenantId` and `monthlyBudget`.
2. Checks if the ledger is already provisioned (idempotent — returns existing group/key if so).
3. Reads `TELNYX_API_KEY` from `env.SECRETS`.
4. Calls `POST /v2/llm_token_gateway/token_groups` with:
   - `name`: the tenant ID
   - `allowed_models`: `["gpt-4o-mini", "gpt-4o"]`
   - `max_budget`: the tenant's monthly budget
   - `budget_duration`: `"30d"`
   - `guardrails`: secrets block (prompt + response), DLP `financial` profile flag (prompt + response), streaming `buffered`
5. Calls `POST /token_groups/{id}/token_keys` to create a primary token key.
6. Persists `tokenGroupId`, `tokenKeyId`, `gatewayBaseUrl`, and `monthlyBudget` in durable actor state via `setState()`.
7. Initializes the SQL schema (`spend_days`, `alerts`, `guardrail_events` tables).
8. Schedules the first hourly rollup via `this.schedule(3600, "rollup", {}, { cron })`.

The tenant's support assistant then calls the LLM through the gateway using the returned `gatewayBaseUrl` and token key — every request is metered by the token group.

### 2. Hourly Rollup (`rollup`)

**Code reference:** `rollup()` method in `src/index.ts`.

Scheduled every hour via `this.schedule()`, the rollup:

1. Reads `TELNYX_API_KEY` from secrets.
2. Calls `GET /v2/llm_token_gateway/usage/summary?token_group_id=...&start_date=...&end_date=...` (lookback window from `SPEND_LOOKBACK_DAYS`, default 31 days).
3. Iterates over `summary.by_day` and upserts each day into the `spend_days` SQL table using `INSERT ... ON CONFLICT(tenant, day) DO UPDATE` — this makes the rollup **idempotent** (re-running doesn't create duplicate rows).
4. Computes month-to-date spend and percentage of budget.
5. If spend crosses `WARN_PCT` (default 80%) and `alerted80` is false in durable state → sends one admin SMS and records an alert row. Sets `alerted80 = true` in state.
6. If spend crosses `HARD_PCT` (default 100%) and `alerted100` is false → sends one admin SMS, records an alert, sets `alerted100 = true`.
7. Updates `lastRollupDay` in durable state.

The alert-once guards (`alerted80`, `alerted100`) live in the actor's durable state — killing and restarting the actor mid-month will **not** re-fire alerts.

### 3. Budget Enforcement at 100%

**Code reference:** `rollup()` method, `spendView()` method.

At 100% of budget, the Telnyx AI Gateway itself denies further inference requests with `403 budget_exceeded` (or `end_user_budget_exceeded`). The actor doesn't need to enforce this — the gateway does. The actor's role is to:

- Flip the tenant's UI into read-only mode (the `spendView` RPC returns `readOnly: true` when `pct >= HARD_PCT`).
- Notify the admin via SMS.

### 4. Guardrail Demo — Secret Detection

**Code reference:** `provision()` method (guardrails config), `rollup()` method (guardrail counts in SQL).

When provisioning a token group, the guardrails block is configured:

```json
{
  "secrets": { "prompt": "block", "response": "block" },
  "dlp": { "profiles": ["financial"], "prompt": "flag", "response": "flag" },
  "streaming": "buffered"
}
```

If a support agent pastes a customer's card number into the tenant's assistant:

1. The gateway's secrets detector **blocks** the request before it reaches the model.
2. A `guardrail_events` row is created with a finding **code** (e.g., `CREDIT_CARD`) — **never** the matched text.
3. The hourly rollup reads `guardrails.blocked_events` and `guardrails.flagged_events` from `usage/summary` and stores them in the `spend_days` SQL table.
4. The `spendView` RPC surfaces these counts on the tenant's spend page.

### 5. Reading the Ledger (`spendView`)

**Code reference:** `spendView()` method in `src/index.ts`.

The tenant dashboard calls:

```
GET /spend?tenantId=ACME
```

The HTTP entry point dispatches to the correct ledger actor, which:

1. Calls `GET /v2/llm_token_gateway/usage/summary` for the lookback window.
2. Reads alert history from the `alerts` SQL table.
3. Returns a `SpendView` object with:
   - `monthToDate` spend and percentage of budget
   - `byModel` breakdown (spend, input/output tokens per model)
   - `guardrails` counts (blocked, flagged)
   - `alerts` list (level + timestamp)
   - `readOnly` flag (true when at or over hard budget)

### 6. Restart Proof

**Code reference:** `rollup()` method, `provision()` method, durable state.

The actor's durable state (`alerted80`, `alerted100`, `tokenGroupId`, `monthlyBudget`, etc.) and the SQL tables (`spend_days`, `alerts`, `guardrail_events`) survive pod restarts. Killing the actor mid-month and restarting it:

- Preserves all rollup data in SQL (no double-counting due to idempotent upserts).
- Preserves alert history (no duplicate alerts due to `alerted80`/`alerted100` flags).
- The next scheduled rollup picks up where it left off.

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `SpendLedger` class exists, that `provision` and `spendView` are decorated with `@rpc`, and that the `rollup` and `sendAdminSms` methods are present. It does **not** make real API calls.

---

## Deploying

```bash
telnyx-edge ship
```

This deploys the actor and HTTP entry point to Telnyx Edge. After deployment, the `/provision` and `/spend` endpoints are live.

---

## Seeding Demo Tenants

To seed two demo tenants (one under budget, one over), you can call the `/provision` endpoint:

```bash
# Under-budget tenant
curl -X POST https://<your-deployment>.telnyx.dev/provision \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "demo-under", "monthlyBudget": 100}'

# Over-budget tenant (will trigger 100% alert on first rollup)
curl -X POST https://<your-deployment>.telnyx.dev/provision \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "demo-over", "monthlyBudget": 1}'
```

Then make some inference calls through the gateway using the returned `gatewayBaseUrl` and token key to generate usage. The hourly rollup will pick up the spend and trigger alerts as thresholds are crossed.

---

## Telnyx Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK** (`Agent<Env, State>`) | `SpendLedger` extends `Agent` for durable per-tenant state, `@rpc` for `provision`/`spendView`, `this.schedule()` for hourly rollup |
| **Stateful Actor** (`env.LEDGERS.idFromName`) | One durable ledger actor per tenant, keyed by tenant ID |
| **SQL Storage** (`env.SPEND_DB`) | `spend_days`, `alerts`, `guardrail_events` tables — the durable ledger |
| **AI Gateway** (`api.telnyx.com/v2/llm_token_gateway`) | Token groups with budgets + guardrails, token keys, `usage/summary`, `spend/events`, `guardrail_events` |
| **Messaging** (`env.TELNYX.messages.send`) | Admin SMS alerts at 80% and 100% of budget (zero-credential `[telnyx]` binding) |
| **Secrets** (`env.SECRETS.get`) | `TELNYX_API_KEY` for gateway management API calls, `DEMO_MODE` flag |

---

## Next Steps

- **[AI Gateway Management API](https://developers.telnyx.com/docs/inference/ai-gateway/management-api)** — token groups, token keys, PATCH for budget/policy changes
- **[AI Gateway Usage](https://developers.telnyx.com/docs/inference/ai-gateway/usage)** — `usage/summary`, `spend/events`, `guardrail_events`
- **[AI Gateway Controls](https://developers.telnyx.com/docs/inference/ai-gateway/controls)** — budget enforcement, `403 budget_exceeded`
- **[AI Gateway Guardrails](https://developers.telnyx.com/docs/inference/ai-gateway/guardrails)** — secrets detection, DLP profiles
- **[Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)** — `idFromName`, durable state, `@rpc`
- **[Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql)** — `prepare`, `bind`, `all`, `run`, `exec`
- **[Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)** — `this.schedule()`, cron expressions
- **[Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)** — for dashboard-side API calls
