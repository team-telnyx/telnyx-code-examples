---
name: attribution-wheel
title: "Attribution Wheel — Who Is Spending What in the AI Gateway"
description: "A durable Telnyx Edge actor that tags every AI Gateway inference request, sweeps nightly spend grouped by tag, and pages on-call when a service breaks its 7-day baseline."
language: typescript
framework: edge
telnyx_products: [AI Gateway, Messaging, Edge Compute]
---

# Attribution Wheel — Who Is Spending What in the AI Gateway

A durable actor that owns the account's AI spend attribution: it tags every inference request, sweeps nightly spend grouped by tag, and pages on-call when a service breaks its own 7-day baseline.

## The Story

A regional telehealth network runs three AI services behind one Telnyx AI Gateway token group — patient support triage, billing dispute resolution, and clinical documentation — and every month the CFO signs a single invoice for all three without being able to say which team burned it. When support quietly triples its token volume overnight after a prompt regression, nobody notices until the invoice lands, and by then the quarter's budget is gone and the platform team is defending a number it cannot explain. An unattributed spend spike is either a silent outage or a runaway feature, and both cost money the network cannot recover.

The actor IS the spend attribution wheel. It is born when `bootstrap()` creates the token group and its three service keys, and from then on it owns the ledger — one row per service per day plus a seven-day rolling baseline of what normal looks like — turning every night at 23:00 UTC to compare each service's share against its own history, write an anomaly row and page the on-call engineer when support jumps from a 20% baseline to 62% of all requests, then write a recovery row and stop paging when support falls back to 18% the next night. When the pod is killed mid-sweep, the next wake resumes at the ledger cursor and no row is written twice, because the ledger is the actor's memory and the actor does not forget.

The rest of this README is the API surface of that story.

## Why Telnyx

Attribution only works if the tagging, the metering, and the alerting live on the same wire. Telnyx AI Gateway lets every inference call carry an `x-ltg-metadata` header with up to five tags, and the same gateway's `spend/summary` endpoint can `group_by=metadata:<key>` on those tags — so the number you alert on is the number the gateway actually billed, with no ETL, no log pipeline, and no reconciliation job in between. Pair that with Telnyx Messaging for the on-call page and Telnyx Edge Compute for the durable actor that remembers yesterday, and you get **AI Communications Infrastructure**: one platform where the inference, the meter, and the page are the same system of record.

Most gateways give you a dashboard. Telnyx gives you a durable entity that can answer "is this normal?" — because it was there yesterday.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/llm_token_gateway/token_groups` | Create the token group that all three services share (requires `Idempotency-Key`) |
| `POST` | `/v2/llm_token_gateway/token_keys` | Create one token key per service — `support`, `billing`, `docs` (requires `Idempotency-Key`) |
| `GET` | `/v2/llm_token_gateway/spend/summary` | Nightly sweep: `group_by=metadata:service`, plus `metadata:tenant` and `metadata:env` for the report view |
| `GET` | `/v2/llm_token_gateway/usage/summary` | Totals, `by_day`, `by_model`, and guardrail counts (scope `llm_token_gateway.usage.read`) |
| `POST` | `https://llm.telnyx.com/v1/chat/completions` | Tagged inference traffic — OpenAI-compatible, authenticated with the `ltg_sk_...` token key |
| `POST` | `https://api.telnyx.com/v2/messages` | On-call page when a service breaches its baseline (via the zero-credential `TELNYX` binding) |

## Architecture

```
   traffic.py / demo scripts
   ┌──────────┬──────────┬──────────┐
   │ support  │ billing  │  docs    │   x-ltg-metadata:
   │ ltg_sk_… │ ltg_sk_… │ ltg_sk_… │   {"service":"support","env":"prod","tenant":"acme"}
   └────┬─────┴────┬─────┴────┬─────┘
        │          │          │
        ▼          ▼          ▼
   ┌─────────────────────────────────┐
   │  Telnyx AI Gateway (token grp)  │  inference: llm.telnyx.com/v1
   └────────────────┬────────────────┘
                    │  spend/summary?group_by=metadata:service
                    │  usage/summary
                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │  AttributionWheel extends Agent<Env, WheelState>           │
   │                                                            │
   │  @rpc bootstrap()          create token group + 3 keys     │
   │  @rpc sweep(day)           pullSpend → baseline → alert    │
   │  @rpc report(day)          full wheel table                │
   │  @rpc seed(days)           ATTRIBUTION_DEMO_MODE synthetic history     │
   │  @rpc simulate(day, prof)  baseline | spike | recovery     │
   │  this.schedule(→23:00 UTC, "nightly")  same sweep path     │
   │                                                            │
   │  state: { tokenGroupId, lastSweepDate, cursor, keyRefs }   │
   └───────────────┬────────────────────────────┬───────────────┘
                   │                            │
                   ▼                            ▼
   ┌───────────────────────────┐   ┌────────────────────────────┐
   │ WHEEL_DB (SQL)            │   │ TELNYX binding             │
   │ spend_daily               │   │ messages.send → on-call    │
   │ PK (date, service)        │   │ (suppressed in ATTRIBUTION_DEMO_MODE)  │
   └───────────────────────────┘   └────────────────────────────┘
```

The actor is one durable entity per token group, addressed as `env.WHEELS.idFromName(mainTokenGroup)`. Its state is small on purpose — `tokenGroupId`, `lastSweepDate`, `cursor`, `keyRefs` — because the real memory is the SQL ledger:

```sql
CREATE TABLE spend_daily (
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0,
  reserved_spend REAL NOT NULL DEFAULT 0,
  unknown_requests INTEGER NOT NULL DEFAULT 0,
  baseline_ratio REAL NOT NULL DEFAULT 0,
  breach INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'gateway',
  note TEXT,
  PRIMARY KEY (date, service)
);
```

The `PRIMARY KEY (date, service)` is the idempotency guarantee. `sweep(day)` walks services in sorted order and writes `cursor` after each one; if the pod dies mid-sweep, the next wake sees `lastSweepDate === day` and resumes at the service after the cursor. Every write is an `ON CONFLICT(date, service) DO UPDATE`, so a resumed sweep can never duplicate a row.

A second table, `spend_dims (date, dim, value, requests, spend)`, holds the per-tenant and per-env attribution so the dashboard can render the full wheel even in demo mode when the gateway has no tagged traffic to report. `writeProfile()` resets and rewrites a day's dims on every `seed()`/`simulate()` call, so the attribution view always matches the ledger.

### The nightly turn

1. `pullSpend(day)` — `GET /spend/summary?start_date=<day>&end_date=<day+1>&group_by=metadata:service`. Dates are half-open and the window is capped at 31 days.
2. `loadBaseline(day)` — reads the previous 7 days from `spend_daily`, computes each service's mean share-of-requests and mean daily spend.
3. `isBreach(share, spend, base)` — true when the service's share **jumps `ATTRIBUTION_ALERT_SHARE_PCT` percentage points over its own 7-day baseline share** (62% vs a 20% baseline is a 42-point jump, default threshold 40) **or** `spend >= base.spend * ATTRIBUTION_SPIKE_MULTIPLE` (default 2.0). With no baseline yet the share is compared to zero, so a first sweep flags anything at 40% or above.
4. `page(row, share, base)` — one SMS to `ONCALL_E164` naming the service, its share, the baseline, and the masked key reference. Suppressed and logged when `ATTRIBUTION_DEMO_MODE=true`.
5. Recovery — if a service was breaching yesterday and is not today, the row is written with `note='recovery'` and no page is sent.

`reserved_spend` and `unknown_requests` are surfaced as their own columns in `report(day)` but are **excluded** from breach and baseline math, because their cost is not yet known.

### Tagging rules

Every inference request carries exactly three tags in the `x-ltg-metadata` header:

```json
{"service":"support","env":"prod","tenant":"acme"}
```

The gateway enforces these constraints, and the demo respects them:

- **Keys** are 1–64 characters matching `[A-Za-z0-9][A-Za-z0-9_.-]*`.
- **Values** are strings ≤256 characters, integers, or booleans.
- **Reserved prefixes** — `ltg_`, `telnyx_`, `litellm_`, `cf_` — are rejected.
- **Non-ASCII** values must be JSON-escaped.
- A rejected header returns `400 invalid_metadata` and **never echoes the header back**, so malformed tags cannot leak tenant data into logs.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `ATTRIBUTION_DEMO_MODE` | `string` | `true` | no | When `true` (default) pages are logged instead of sent and `seed()`/`simulate()` are enabled. Set to `false` for live SMS and real gateway pulls. | — |
| `ATTRIBUTION_ONCALL_E164` | `string` | `+1555XXXXXXX` | no (yes in live mode) | E.164 number that receives the breach page. | Your on-call rotation |
| `ATTRIBUTION_DEMO_NUMBER` | `string` | `+1555XXXXXXX` | no (yes in live mode) | Telnyx sender number for the page SMS. | [portal.telnyx.com](https://portal.telnyx.com) → Numbers |
| `ATTRIBUTION_ALERT_SHARE_PCT` | `string` | `40` | no | Share-of-requests percentage that triggers a breach. Default `40`. | — |
| `ATTRIBUTION_SPIKE_MULTIPLE` | `string` | `2.0` | no | Multiple of the 7-day mean daily spend that triggers a breach. Default `2.0`. | — |
| `AI_GATEWAY_MODEL` | `string` | `Kimi-K3` | no | Model used by `traffic.py` for tagged inference requests. | [AI Gateway models](https://developers.telnyx.com/docs/inference/ai-gateway) |

`TELNYX_API_KEY` is declared as a `[[secrets]]` binding and read via `await this.env.SECRETS.get("TELNYX_API_KEY")`. It is never written to the repo, never logged, and never sent to the inference plane — inference authenticates with the `ltg_sk_...` token key instead.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/attribution-wheel
npm install
cp .env.example .env
```

Fill in `.env` (placeholders only — never commit real credentials):

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
ATTRIBUTION_DEMO_MODE=true
ATTRIBUTION_ONCALL_E164=+1555XXXXXXX
ATTRIBUTION_DEMO_NUMBER=+1555XXXXXXX
ATTRIBUTION_ALERT_SHARE_PCT=40
ATTRIBUTION_SPIKE_MULTIPLE=2.0
AI_GATEWAY_MODEL=Kimi-K3
```

Authenticate the CLI, generate binding types, and ship:

```bash
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge types          # regenerates telnyx-env.d.ts from telnyx.toml
telnyx-edge ship           # deploy
telnyx-edge actors list    # confirm AttributionWheel is live
```

`telnyx.toml` declares the actor, the SQL database, the secret, and the zero-credential Telnyx binding:

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
binding = "ATTRIBUTION_DEMO_MODE"
name    = "ATTRIBUTION_DEMO_MODE"

[[secrets]]
binding = "ATTRIBUTION_ALERT_SHARE_PCT"
name    = "ATTRIBUTION_ALERT_SHARE_PCT"

[[secrets]]
binding = "ATTRIBUTION_SPIKE_MULTIPLE"
name    = "ATTRIBUTION_SPIKE_MULTIPLE"

[[secrets]]
binding = "ATTRIBUTION_ONCALL_E164"
name    = "ATTRIBUTION_ONCALL_E164"

[[secrets]]
binding = "ATTRIBUTION_DEMO_NUMBER"
name    = "ATTRIBUTION_DEMO_NUMBER"
```

> The Edge runtime does not inject `[env_vars]` into actor projects, so every
> knob ships as a `[[secrets]]` binding and is read via `SECRETS.get()` with a
> plain env-var fallback (for local tooling).

### Run the demo

Every RPC is `POST /rpc/<method>` with a JSON array of positional arguments as the body:

```bash
BASE=https://attribution-wheel.<your-subdomain>.telnyx.app

# 1. Bootstrap — creates the token group + support/billing/docs keys, arms the nightly run
curl -s -X POST "$BASE/rpc/bootstrap?group=main" -d '[]'

# 2. Seed 7 days of baseline history (ATTRIBUTION_DEMO_MODE only — gateway usage cannot be backdated)
curl -s -X POST "$BASE/rpc/seed?group=main" -d '[7]'

# 3. Day 1 — support jumps to 62% of requests against a 20% baseline
curl -s -X POST "$BASE/rpc/simulate?group=main" -d '["2026-11-10","spike"]'
curl -s -X POST "$BASE/rpc/sweep?group=main"    -d '["2026-11-10"]'
#    → one anomaly row (baseline_ratio 3.1), one on-call page (logged in ATTRIBUTION_DEMO_MODE)

# 4. Day 2 — support falls back to 18%
curl -s -X POST "$BASE/rpc/simulate?group=main" -d '["2026-11-11","recovery"]'
curl -s -X POST "$BASE/rpc/sweep?group=main"    -d '["2026-11-11"]'
#    → one recovery row, no repeat page

# 5. The full wheel — JSON
curl -s -X POST "$BASE/rpc/report?group=main" -d '["2026-11-10"]'
#    … or open the Telnyx-branded dashboard in a browser:
open "$BASE/?group=main"
```

`traffic.py` drives the same flow from the shell. With `ATTRIBUTION_DEMO_MODE=true` (the default) `traffic.py --days 7` calls `@rpc seed(days)` so the rolling baseline has clearly-marked `source='synthetic'` history. With `ATTRIBUTION_DEMO_MODE=false` it sends real tagged inference requests to `https://llm.telnyx.com/v1/chat/completions` for today only, and the baseline computes share-of-requests ratios from whatever real history exists (≥1 day).

### Resume proof

Kill the actor mid-sweep and call `sweep(day)` again for the same day. The response reports `resumedFrom: "<service>"`, the sweep continues from the service after the cursor, and `report(day)` shows exactly one row per service — the `PRIMARY KEY (date, service)` plus the `ON CONFLICT DO UPDATE` upsert make double-writing impossible.

## API Reference

Public async methods on `AttributionWheel` are the RPC surface. The default export forwards requests to `env.WHEELS.get(env.WHEELS.idFromName(group))`, so `?group=<name>` selects the actor instance (default `main`).

| RPC | Params | Returns | Description |
|-----|--------|---------|-------------|
| `bootstrap()` | — | `{ tokenGroupId, keys }` | Creates the token group and one token key per service with `Idempotency-Key` headers, stores masked key refs in state, and arms the nightly schedule. Idempotent: a second call returns the existing group. |
| `sweep(day)` | `day: "YYYY-MM-DD"` | `{ day, rows, paged, resumedFrom, usage }` | The same code path the `nightly` schedule invokes. Pulls spend, computes the baseline, writes ledger rows, pages on new breaches, resumes from the cursor if interrupted, and reports the gateway `usage/summary` totals + guardrail counts when a token group is bound. |
| `report(day)` | `day: "YYYY-MM-DD"` | `Report` | The full wheel: per-service ledger rows, totals, plus `byTenant` and `byEnv` attribution from `group_by=metadata:tenant` / `metadata:env` (falling back to the local dims ledger), and the `usage/summary` snapshot. |
| `seed(days)` | `days: number` (1–30) | `{ seeded, profile }` | **ATTRIBUTION_DEMO_MODE only.** Writes `source='synthetic'` baseline rows so the 7-day rolling mean has history. |
| `simulate(day, profile)` | `day`, `profile: "baseline" \| "spike" \| "recovery"` | `{ day, profile, rows }` | **ATTRIBUTION_DEMO_MODE only.** Writes a named traffic profile for a day. |
| `reset()` | — | `{ cleared }` | **ATTRIBUTION_DEMO_MODE only.** Clears the ledger and cursor so the Day-1/Day-2 demo can be re-run from a blank slate. The token group and keys are untouched. |
| `nightly()` | — | `void` | Scheduled handler. Sweeps yesterday, then re-arms itself for the next 23:00 UTC run. |

`Report` shape:

```ts
interface Report {
  day: string;
  rows: SpendRow[];                 // date, service, requests, input_tokens, output_tokens,
                                    // spend, reserved_spend, unknown_requests,
                                    // baseline_ratio, breach, source, note
  totals: { requests; input_tokens; output_tokens; spend; reserved_spend; unknown_requests };
  byTenant: { value: string; requests: number; spend: number }[];
  byEnv:    { value: string; requests: number; spend: number }[];
  usage:   { totals: UsageTotals; guardrails: { blocked_events; flagged_events } } | null;
}
```

HTTP surface:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` or `/ui` | Telnyx-branded attribution dashboard for `?day=<YYYY-MM-DD>` (default: today) |
| `GET` | `/health` | Liveness probe — `{ ok: true, actor: "AttributionWheel", demo_mode }` |
| `GET` | `/report?day=<YYYY-MM-DD>` | The `report(day)` JSON without a POST round-trip |
| `POST` | `/rpc/<method>?group=<name>` | JSON array body of positional args, routed to the actor's `@rpc()` method |

Status codes: `200` on success, `400` for a malformed `day`, unknown profile, or non-array RPC body, `405` for a `GET` on `/rpc/*`, `401` when `TELNYX_API_KEY` is missing or lacks `llm_token_gateway.write`, `500` for upstream gateway failures (the message is generic; details go to the log).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TELNYX_API_KEY is not configured` | Secret binding not set on the deployed actor | `telnyx-edge secrets add TELNYX_API_KEY "..."` then `telnyx-edge ship` |
| `AI Gateway POST /token_groups failed with 401` | API key lacks AI Gateway write scope | Use an account key with `llm_token_gateway.write` |
| `spend/summary unavailable for <day>` warning, zero rows | No tagged traffic landed for that day, or the tag key was never sent | Send at least one request with `x-ltg-metadata: {"service":"..."}`; in ATTRIBUTION_DEMO_MODE run `seed(7)` |
| `baseline_ratio` is `0.00` on every row | No history in the 7 days before the sweep day | `seed(7)` (ATTRIBUTION_DEMO_MODE) or wait for real history to accumulate |
| No SMS arrives in live mode | `ONCALL_E164` or `DEMO_TELNYX_NUMBER` unset, or `ATTRIBUTION_DEMO_MODE` still `true` | Set both numbers and `ATTRIBUTION_DEMO_MODE=false`; check the actor log for `[DEMO] page suppressed` |
| `seed() is only available when DEMO_MODE=true` | Called `seed`/`simulate` in live mode | Set `ATTRIBUTION_DEMO_MODE=true` for the demo, or use real tagged traffic |
| `day must be YYYY-MM-DD` | Malformed date argument | Pass an ISO date, e.g. `2026-11-10` |
| `400 invalid_metadata` from the gateway | Tag key violates `[A-Za-z0-9][A-Za-z0-9_.-]*`, value >256 chars, or a reserved prefix (`ltg_`, `telnyx_`, `litellm_`, `cf_`) | Rename the key; the error never echoes the header, so check your client-side payload |
| Sweep re-pages the same service | `breach` was reset by a manual ledger edit | Let the actor own the ledger — `previousBreach()` reads the last row before the sweep day |

## Agent Discovery

- [Agent signup](https://telnyx.com/agent-signup.md) — provision an agent identity and get an API key
- [team-telnyx/ai](https://github.com/team-telnyx/ai) — the Telnyx AI examples and tooling monorepo
- [llms.txt](https://developers.telnyx.com/llms.txt) — machine-readable index of the Telnyx developer docs

## Related Examples

- [`ai-gateway-tenant-meter`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-gateway-tenant-meter/README.md) — AI Gateway metering per tenant on the same gateway
- [`gateway-fallbacks`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/gateway-fallbacks/README.md) — model failover and retry policy in front of the gateway
- [`multi-model-inference-switcher`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/README.md) — switching between models on the OpenAI-compatible inference plane
- [`edge-cron-scheduler`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cron-scheduler/README.md) — the Agent SDK `this.schedule()` pattern in isolation
- [`edge-outage-hotline-typescript`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-outage-hotline-typescript/README.md) — Telnyx Edge actor that phones and texts humans when things break

## Resources

- [AI Gateway usage reporting](https://developers.telnyx.com/docs/inference/ai-gateway/usage)
- [Get gateway usage summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-usage-summary)
- [Get gateway spend summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-spend-summary)
- [Create gateway token group](https://developers.telnyx.com/api-reference/ai-gateway/create-gateway-token-group)
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Send a message](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx AI Gateway product page](https://telnyx.com/products/ai-gateway)
- [Telnyx pricing](https://telnyx.com/pricing)
