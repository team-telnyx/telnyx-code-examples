# Attribution Wheel — A Guided Tour

This guide walks you through `attribution-wheel`, a TypeScript Telnyx Edge sample that answers the one question every multi-team AI Gateway rollout eventually asks: **who is spending what?**

The actor in this sample is not a dashboard and not a billing export. It is a durable entity — an `AttributionWheel` — that wakes up every night, pulls the AI Gateway's spend summary grouped by request tag, compares each service's share against a 7-day rolling baseline, and pages the on-call when something is off. When the spike recovers, it records the recovery and stops paging. No human in the loop.

By the end of this guide you'll understand every moving part: the Agent SDK durable state, the token group and per-service keys, the `x-ltg-metadata` tagging, the `group_by=metadata:<key>` reporting call, the breach/recovery state machine, and the Telnyx Messaging page.

---

## What you're building

Three services — `support`, `billing`, and `docs` — share one AI Gateway token group. Each service gets its own token key, and every inference request carries an `x-ltg-metadata` header tagging it with `service`, `env`, and `tenant`.

A nightly sweep:

1. Pulls `GET /v2/llm_token_gateway/spend/summary?group_by=metadata:service` for the day.
2. Loads a 7-day rolling baseline per service from the local SQL ledger.
3. Computes each service's share of total requests and compares it to its baseline share.
4. If a service crosses `ALERT_SHARE_PCT` (default 40%) **or** its spend doubles the baseline (`SPIKE_MULTIPLE`, default 2.0), it writes an anomaly row and pages the on-call via SMS.
5. If a service that was breaching yesterday is no longer breaching, it writes a recovery row and does **not** page again.

The whole thing is idempotent on `(date, service)` and resumable via a cursor, so a pod killed mid-sweep picks up where it left off on the next wake.

---

## Prerequisites

- Node.js 20+ and `npx`
- A Telnyx account with AI Gateway access
- The `telnyx-edge` CLI installed and authenticated:
  ```bash
  telnyx-edge auth api-key set <YOUR_API_KEY>
  ```
- A Telnyx phone number for the on-call sender (`DEMO_TELNYX_NUMBER`) and an on-call recipient (`ONCALL_E164`) — only needed for **live** mode. Demo mode logs the page instead of sending it.

---

## Project layout

```
attribution-wheel/
├── src/
│   └── index.ts        # the AttributionWheel agent + fetch handler
├── telnyx.toml         # actor, secret, SQL, and Telnyx API bindings
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md            # you are here
```

The entry point **must** be `src/index.ts` — `package.json`'s `"main"`, `tsconfig.json`'s `include`, and the smoke test all depend on that path.

---

## Environment setup

### `telnyx.toml`

The bindings the code expects are declared here:

```toml
name = "attribution-wheel"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "WHEELS"
type    = "AttributionWheel"

[telnyx]
binding = "TELNYX"

[storage.sqldb.WHEEL_DB]
id = "<sqldb-namespace-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "DEMO_MODE"
name    = "DEMO_MODE"

[[secrets]]
binding = "ALERT_SHARE_PCT"
name    = "ALERT_SHARE_PCT"

[[secrets]]
binding = "SPIKE_MULTIPLE"
name    = "SPIKE_MULTIPLE"

[[secrets]]
binding = "ONCALL_E164"
name    = "ONCALL_E164"

[[secrets]]
binding = "DEMO_TELNYX_NUMBER"
name    = "DEMO_TELNYX_NUMBER"
```

> The Edge runtime does not inject `[env_vars]` into actor projects, so every
> knob ships as a `[[secrets]]` binding and is read via `SECRETS.get()` with a
> plain env-var fallback (for local tooling).

After editing `telnyx.toml`, regenerate the typed env declarations:

```bash
telnyx-edge types
```

### `.env.example`

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
DEMO_MODE=true
ONCALL_E164=+1555XXXXXXXX
DEMO_TELNYX_NUMBER=+1555XXXXXXXX
ALERT_SHARE_PCT=40
SPIKE_MULTIPLE=2.0
AI_GATEWAY_MODEL=Kimi-K3
```

Set the real secret with the CLI (never commit it):

```bash
telnyx-edge secrets add TELNYX_API_KEY "KEY..."
```

### Environment variables the code reads

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_MODE` | `true` | When `true`, no SMS is sent and `seed()`/`simulate()` are available. |
| `ONCALL_E164` | — | On-call recipient (live mode only). |
| `DEMO_TELNYX_NUMBER` | — | Sender number (live mode only). |
| `ALERT_SHARE_PCT` | `40` | Share-of-requests jump (percentage points) over the service's own baseline that triggers a breach. |
| `SPIKE_MULTIPLE` | `2.0` | Spend multiple vs baseline that triggers a breach. |
| `AI_GATEWAY_MODEL` | `Kimi-K3` | Model used by the demo traffic scripts. |

---

## The Agent: durable state and the RPC surface

`AttributionWheel` extends `Agent<Env, WheelState>` from `@telnyx/edge-runtime`. The Agent SDK owns the durable attribution — the ledger and the baselines — not the chart.

The state shape is small and deliberate:

```ts
interface WheelState {
  tokenGroupId: string | null;
  lastSweepDate: string | null;
  cursor: string | null;
  keyRefs: Record<string, string>;
}
```

- `tokenGroupId` — the AI Gateway token group created at bootstrap.
- `lastSweepDate` + `cursor` — the resume point for a mid-sweep crash.
- `keyRefs` — masked key references (`ltg_sk...`) used in the page text so the on-call knows which key to look at without exposing the full secret.

`initialState()` seeds all of these to `null` / `{}`. State is read with `this.getState()` and patched with `this.setState({ ... })` — merge-patch semantics, so `setState({ cursor })` only touches `cursor`.

The remote surface is marked with the SDK's `@rpc()` decorator: `bootstrap`, `sweep`, `report`, `seed`, and `simulate`. (`nightly` is deliberately *not* decorated — it is the scheduled handler, not an RPC.) The `fetch` handler at the bottom of `src/index.ts` resolves the actor stub and dispatches the call:

```ts
const stub = env.WHEELS.idFromName(group);
// POST /rpc/sweep with a JSON array body → stub.sweep(...args)
```

The worker routes:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` or `/ui` | Telnyx-branded dashboard (server-rendered from `report(day)`) |
| `GET` | `/health` | `{ ok, actor, group, demo_mode }` |
| `GET` | `/report?day=YYYY-MM-DD` | `report(day)` as JSON |
| `POST` | `/rpc/<method>?group=<name>` | JSON **array** body of positional args, dispatched to the `@rpc()` method |

The actor is born via `env.WHEELS.idFromName(mainTokenGroup)` — one durable entity per token group, selected with `?group=` (default `main`).

---

## Step 1 — Bootstrap: token group + three keys

`bootstrap()` is the first RPC you call. It:

1. Short-circuits if `state.tokenGroupId` is already set (idempotent).
2. Creates the token group with `POST /v2/llm_token_gateway/token_groups`, passing an `Idempotency-Key` header keyed on the date.
3. Loops over `SERVICES` (`support`, `billing`, `docs`) and creates one token key per service with `POST /v2/llm_token_gateway/token_keys`, each with its own `Idempotency-Key`.
4. Stores the group id and masked key refs in state.
5. Arms the nightly run with `this.schedule(this.secondsUntil2300(), "nightly")`.

The `gateway()` helper is the single choke point for all AI Gateway calls. It pulls `TELNYX_API_KEY` from the `SECRETS` binding, sets the `Authorization` header, attaches `Idempotency-Key` when provided, and unwraps the `{ data: ... }` envelope. Every gateway call in the sample goes through it — no scattered `fetch` calls.

> **Why `Idempotency-Key` matters:** token group and key mutations are not free to retry. If the actor crashes between the create and the `setState`, the next `bootstrap()` call would otherwise create a duplicate group. The idempotency key makes the retry safe.

---

## Step 2 — Traffic: tagging requests

Each inference request carries an `x-ltg-metadata` header:

```
x-ltg-metadata: {"service":"support","env":"prod","tenant":"acme"}
```

The demo sends exactly three tags per request — `service`, `env`, `tenant`. The AI Gateway accepts up to five tags per request.

### Tagging rules (enforced by the gateway)

- **Keys** are 1–64 characters matching `[A-Za-z0-9][A-Za-z0-9_.-]*`.
- **Values** are strings ≤256 characters, integers, or booleans.
- **Reserved prefixes** — `ltg_`, `telnyx_`, `litellm_`, `cf_` — are rejected.
- Non-ASCII values must be JSON-escaped.
- A `400 invalid_metadata` response never echoes the offending header back.

The inference plane authenticates with the **token key** (`ltg_sk_...`), not the account API key. The base URL is `https://llm.telnyx.com/v1` (OpenAI-compatible chat completions), and the model comes from `AI_GATEWAY_MODEL` with a default of `Kimi-K3`. Every request sets `max_tokens`.

`traffic.py` drives this. In demo mode it calls `@rpc seed(days)` instead of sending real requests (see Step 6). In live mode it sends real tagged requests for today only.

---

## Step 3 — The nightly sweep

`sweep(day)` is the same code path the `NIGHTLY` schedule invokes. It is also callable on demand via `@rpc sweep(day)` so the demo can run Day-1 and Day-2 sweeps in minutes instead of waiting for 23:00.

The sweep is a three-stage pipeline:

```
pullSpend(day)  →  loadBaseline(day)  →  per-service: isBreach() → upsert() → page()
```

### `pullSpend(day)`

Calls `GET /v2/llm_token_gateway/spend/summary` with:

```
start_date=<day>
end_date=<day+1>          # half-open interval
group_by=metadata:service
```

The response is one row per tag value — spend, requests, and tokens per service. `normalize()` maps each row into a `SpendRow`, defaulting missing fields to zero.

If the gateway call fails (or returns nothing) and `DEMO_MODE` is on, `pullSpend()` falls back to the local ledger so the demo still runs offline.

### `loadBaseline(day)`

Reads the previous 7 days from the `spend_daily` table:

```sql
SELECT date, service, requests, spend
FROM spend_daily
WHERE date >= ? AND date < ?
```

It computes each service's **share of requests per day**, then averages those shares across the days present. The result is a `Map<service, { share, spend }>` — the rolling baseline. Days with zero total requests are skipped so a quiet day doesn't drag the mean to zero.

### The breach decision — `isBreach()`

```ts
const shareJump = (share - (base?.share ?? 0)) * 100;
if (shareJump >= ALERT_SHARE_PCT) return true;
return base && base.spend > 0 && spend >= base.spend * SPIKE_MULTIPLE;
```

Two independent triggers:

1. **Share jump** — the service's share of requests climbed at least `ALERT_SHARE_PCT` (default 40) percentage points **above its own baseline share**. A service jumping from a 20% baseline to 62% is a 42-point jump → breach. With no baseline yet (cold start) the jump is measured from zero, so anything at 40% or above is flagged.
2. **Spend spike** — the service's spend is at least `SPIKE_MULTIPLE` (default 2.0×) its baseline spend.

Either one is enough. The `baseline_ratio` stored on the row is `share / baseline.share` — so a service at 62% against a 20% baseline records `3.1`.

### The breach/recovery state machine

For each service row, the sweep:

1. Looks up the existing row for `(day, service)` — `existingRow()`.
2. Looks up the most recent prior breach — `previousBreach()`.
3. Sets `note` to `"anomaly"` on a first breach, `"continued"` while the breach persists across days, `"recovery"` if it was breaching yesterday and isn't today, otherwise `null`.
4. Upserts the row.
5. Pages **only** if the row is breaching **and** it wasn't already breaching (no existing breach flag, no prior breach). This is what prevents a repeat page on Day 2.

The recovery path is the mirror image: a service that was breaching yesterday and is under threshold today gets a `recovery` note and no page.

---

## Step 4 — The page

`page(row, share, base)` builds the on-call message:

```
AI spend: support at 62% of 24h requests (baseline 20%). Keys: sk-...-support.
```

The key reference comes from `state.keyRefs` — masked to `sk-...-support` so the on-call knows which key to inspect without the full secret landing in an SMS.

- **Demo mode:** the page is logged with the recipient masked (`***1234`) and nothing is sent.
- **Live mode:** `this.env.TELNYX.messages.send({ to, from, text })` sends the SMS via the Telnyx Messaging API. `ONCALL_E164` and `DEMO_TELNYX_NUMBER` are required; the code throws if either is missing.

The `TELNYX` binding is the zero-credential platform binding — auth is injected, so no API key is passed at the call site.

---

## Step 5 — The report

`report(day)` returns the full wheel for a day:

```ts
interface Report {
  day: string;
  rows: SpendRow[];          // per service, from the ledger
  totals: { requests, input_tokens, output_tokens, spend, reserved_spend, unknown_requests };
  byTenant: { value, requests, spend }[];
  byEnv:    { value, requests, spend }[];
}
```

- `rows` comes from `ledgerDay(day)` — the persisted `spend_daily` rows ordered by service.
- `totals` sums the ledger rows.
- `byTenant` and `byEnv` call `grouped(day, "tenant")` / `grouped(day, "env")`, which hit `spend/summary` with `group_by=metadata:tenant` and `group_by=metadata:env` respectively. If the gateway call fails, they return `[]` rather than throwing.

### `reserved_spend` and `unknown_requests`

These two columns are surfaced on their own and **excluded from breach/baseline math**:

- `reserved_spend` — the USD budget hold still outstanding for requests whose usage is unknown.
- `unknown_requests` — the count of those requests (their input/output tokens are null).

Unknown cost is excluded from `spend`, and both fields are excluded from the share and spike calculations. They are always displayed in the report so you can see how much spend is still unresolved.

---

## Step 6 — Demo mode: seeding and simulating

Gateway usage cannot be backdated, so a fresh actor has no history for the 7-day baseline to compare against. The sample solves this with two demo-only RPCs:

- **`seed(days)`** — writes `days` (clamped 1–30) of synthetic baseline rows into `spend_daily`, clearly marked `source='synthetic'`. This gives the rolling mean real history to average.
- **`simulate(day, profile)`** — writes a named traffic profile for a single day. Profiles are `baseline`, `spike`, and `recovery`, each a per-service request mix:

  ```ts
  baseline: { support: 0.20, billing: 0.45, docs: 0.35 }
  spike:    { support: 0.62, billing: 0.22, docs: 0.16 }
  recovery: { support: 0.18, billing: 0.47, docs: 0.35 }
  ```

Both throw if `DEMO_MODE=false`. `writeProfile()` computes requests, tokens, and spend from the mix and upserts each row with `source='synthetic'` and a `note` of `seeded:<profile>`.

`traffic.py` uses these:

- `DEMO_MODE=true` (default): `traffic.py --days 7` calls `@rpc seed(7)`.
- `DEMO_MODE=false`: `traffic.py` sends real tagged inference requests for today only, and the baseline computes share-of-requests ratios from whatever real history exists (≥1 day).

---

## Step 7 — Scheduling and resume

### `nightly()`

The scheduled handler calls `sweep(yesterday)` and then re-arms itself:

```ts
async nightly(): Promise<void> {
  try {
    await this.sweep(shiftDate(todayUtc(), -1));
  } finally {
    await this.schedule(this.secondsUntil2300(), "nightly");
  }
}
```

`this.schedule()` takes a **delay in seconds**, not a cron string, so `secondsUntil2300()` computes the seconds until the next 23:00 UTC and re-arms. The `finally` block guarantees the next run is scheduled even if the sweep throws.

### Resume proof

The sweep writes `lastSweepDate` and `cursor` after every service row. If the pod is killed mid-sweep:

1. On the next wake, `sweep(day)` sees `state.lastSweepDate === day` and reads `resumedFrom = state.cursor`.
2. It sorts the pulled rows by service and skips everything up to and including the cursor.
3. It continues from the next service.

Because `upsert()` uses `ON CONFLICT(date, service) DO UPDATE`, even a re-run of an already-written row is safe — no row is written twice. The `resumedFrom` value is returned from `sweep()` so you can see the resume in the demo output.

---

## Running the demo

### 1. Deploy

```bash
npm install
telnyx-edge types
telnyx-edge ship
```

### 2. Bootstrap the actor

```bash
curl -X POST "https://<your-actor-host>/rpc/bootstrap?group=main" -d '[]'
```

This creates the token group and the three keys, and arms the nightly run.

### 3. Seed a week of baseline history (demo mode)

```bash
curl -X POST "https://<your-actor-host>/rpc/seed?group=main" \
  -H "Content-Type: application/json" \
  -d '[7]'
```

Or via the traffic script:

```bash
python traffic.py --days 7
```

### 4. Day 1 — simulate the spike and sweep

```bash
curl -X POST "https://<your-actor-host>/rpc/simulate?group=main" \
  -H "Content-Type: application/json" \
  -d '["2026-11-10", "spike"]'

curl -X POST "https://<your-actor-host>/rpc/sweep?group=main" \
  -H "Content-Type: application/json" \
  -d '["2026-11-10"]'
```

Expect: support at ~62% of requests against a ~20% baseline → one anomaly row (`baseline_ratio` ~3.1) and one page (logged in demo mode).

### 5. Day 2 — simulate recovery and sweep

```bash
curl -X POST "https://<your-actor-host>/rpc/simulate?group=main" \
  -H "Content-Type: application/json" \
  -d '["2026-11-11", "recovery"]'

curl -X POST "https://<your-actor-host>/rpc/sweep?group=main" \
  -H "Content-Type: application/json" \
  -d '["2026-11-11"]'
```

Expect: support drops to ~18% → one recovery row, **no** repeat page.

### 6. Read the wheel

```bash
curl "https://<your-actor-host>/report?group=main&day=2026-11-10"
```

Returns the per-service ledger, totals, the per-tenant / per-env attribution breakdown, and the gateway `usage/summary` snapshot. The same view is served as the Telnyx-branded dashboard at `GET /?group=main&day=2026-11-10` — open it in a browser to watch the wheel turn.

### 7. Prove resume

Kill the actor mid-sweep (or call `sweep` for a day with a pre-set cursor), then call `sweep(day)` again. The response's `resumedFrom` field shows the cursor it picked up from, and the ledger has no duplicate rows.

---

## Demo mode vs live mode

| | Demo mode (`DEMO_MODE=true`, default) | Live mode (`DEMO_MODE=false`) |
|---|---|---|
| Pages | Logged with masked recipient | Real SMS via `TELNYX.messages.send` |
| Baseline history | `seed()` writes synthetic rows | Real tagged requests only |
| Traffic | `simulate()` writes profiles | `traffic.py` sends real inference requests |
| `seed()` / `simulate()` | Available | Throw |
| Required env | None beyond defaults | `ONCALL_E164`, `DEMO_TELNYX_NUMBER`, `TELNYX_API_KEY` |

To switch to live mode, set `DEMO_MODE=false` as a `[[secrets]]` binding in `telnyx.toml` (or via `telnyx-edge secrets add DEMO_MODE "false"`), set the on-call numbers, and redeploy. The sweep, baseline, and report logic are identical — only the page transport and the data source change.

---

## How the pieces fit together

```
bootstrap()
  └─ POST /token_groups          (Idempotency-Key)
  └─ POST /token_keys × 3        (support, billing, docs)
  └─ this.schedule(secondsUntil2300(), "nightly")

nightly()  ──►  sweep(yesterday)  ──►  this.schedule(...)   (re-arm)

sweep(day)
  ├─ pullSpend(day)      GET /spend/summary?group_by=metadata:service (paged)
  ├─ pullUsage(day)      GET /usage/summary?token_group_id=... (totals + guardrails)
  ├─ loadBaseline(day)   SELECT ... FROM spend_daily WHERE date >= day-7
  └─ per service:
       ├─ isBreach(share, spend, base)   ALERT_SHARE_PCT / SPIKE_MULTIPLE
       ├─ upsert(row)                    ON CONFLICT(date, service)
       ├─ page(row)                      TELNYX.messages.send  (live only)
       └─ setState({ cursor })

report(day)
  ├─ ledgerDay(day)                    SELECT ... WHERE date = day
  ├─ grouped(day, "tenant")            GET /spend/summary?group_by=metadata:tenant
  │                                    (falls back to spend_dims ledger)
  ├─ grouped(day, "env")               GET /spend/summary?group_by=metadata:env
  │                                    (falls back to spend_dims ledger)
  └─ pullUsage(day)                    gateway usage snapshot
```

---

## Troubleshooting

**`TELNYX_API_KEY is not configured`** — the secret isn't set. Run `telnyx-edge secrets add TELNYX_API_KEY "KEY..."` and redeploy.

**`token group create returned no id`** — the gateway returned a `data` envelope without an `id`. Check that your API key has AI Gateway write access and that the `Idempotency-Key` isn't colliding with a failed prior attempt.

**`seed() is only available when DEMO_MODE=true`** — you're in live mode. Either flip `DEMO_MODE` back to `true` for the demo, or send real tagged traffic with `traffic.py`.

**`ONCALL_E164 and DEMO_TELNYX_NUMBER are required in live mode`** — set both env vars before switching to live mode.

**No breach on Day 1** — confirm `seed()` ran first. Without baseline history, `loadBaseline()` returns an empty map and `isBreach()` falls back to the share threshold only (which still fires at 62%, but the `baseline_ratio` will be `0`).

**Duplicate rows after a crash** — shouldn't happen: `upsert()` is `ON CONFLICT(date, service) DO UPDATE`. If you see duplicates, check that the `spend_daily` primary key is `(date, service)` — `ensureSchema()` creates it that way.

---

## Next steps

- [AI Gateway usage reporting](https://developers.telnyx.com/docs/inference/ai-gateway/usage) — the full usage and spend summary surface.
- [Get gateway usage summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-usage-summary) — totals, `by_day`, `by_model`, guardrail counts.
- [Get gateway spend summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-spend-summary) — the `group_by=metadata:<key>` call this sample is built on.
- [Create gateway token group](https://developers.telnyx.com/api-reference/ai-gateway/create-gateway-token-group) — the bootstrap primitive.
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk) — `Agent`, `this.schedule()`, durable state, and the RPC surface.
- [Telnyx Messaging API](https://developers.telnyx.com/api-reference/messages/send-a-message) — the on-call page transport.

Related samples in this repo:

- **`ai-gateway-tenant-meter`** — metering on the same gateway, one level down the attribution stack.
- **`gateway-fallbacks`** — model failover on the same gateway.

The attribution wheel composes with both: fallbacks keep spend flowing, the tenant meter counts it, and the wheel tells you *who* is spending it and whether that is normal.
