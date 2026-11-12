# API Reference — `attribution-wheel`

Typed contract for the three surfaces this sample exposes or consumes:

1. **Edge HTTP routes** on the deployed worker (`src/index.ts` default export).
2. **Actor RPC methods** on the `AttributionWheel` agent (`@rpc()`-decorated public async methods, callable over `POST /rpc/<method>` or directly from a stub).
3. **Outbound Telnyx API calls** the actor makes (AI Gateway token groups/keys, spend + usage summaries, Messaging).

---

## Transport & conventions

| Item | Value |
|---|---|
| Base URL (worker) | `https://<your-actor-host>` (assigned by `telnyx-edge ship`) |
| Content type | `application/json` |
| Actor addressing | `?group=<name>` query param on the worker URL; defaults to `main`. RPC calls are `POST /rpc/<method>` with a JSON array of positional arguments |
| Actor identity | `env.WHEELS.idFromName(<group>)` — one durable `AttributionWheel` per token group |
| Date format | `YYYY-MM-DD` (UTC). All ranges are **half-open**: `start_date` inclusive, `end_date` exclusive |
| Auth (inbound) | None on the demo worker. Do not expose a live-mode deployment publicly without an edge auth layer |
| Auth (outbound) | `Authorization: Bearer <TELNYX_API_KEY>` read from the `SECRETS` binding — never from code |

### Error envelope

RPC failures surface as a non-2xx response whose body carries the thrown message:

```json
{ "error": "day must be YYYY-MM-DD" }
```

Messages are intentionally generic for upstream failures (`AI Gateway GET /spend/summary failed with 502`) — no response bodies, headers, or credentials are echoed back.

---

## HTTP routes

### `GET /health`

Liveness probe. Reads config; does not touch the database or the Telnyx API.

**Request body:** none.

**Response — `200 OK`**

```json
{ "ok": true, "actor": "AttributionWheel", "group": "main", "demo_mode": true }
```

| Status | Meaning |
|---|---|
| `200` | Worker is up |
| `500` | Worker failed to boot (binding misconfiguration) |

**Example**

```bash
curl -s https://<your-actor-host>/health
```

---

### `GET /` and `GET /ui` — attribution dashboard

Server-rendered, Telnyx-branded HTML dashboard for the day. Reads `report(day)` from the actor stub; never mutates state.

| Query param | Type | Required | Default | Description |
|---|---|---|---|---|
| `day` | `YYYY-MM-DD` | no | today (UTC) | Day to render |
| `group` | string | no | `main` | Actor instance |

Renders the wheel (today's share vs the 7-day baseline ring), the ledger table with breach/recovery badges, totals, per-tenant and per-env bars, and the gateway `usage/summary` snapshot when available. Refreshes every 30 seconds; shows the live-mode or demo-mode badge in the header.

| Status | Meaning |
|---|---|
| `200` | Dashboard rendered (empty state if the ledger has no rows for the day) |
| `500` | SQL failure reading the ledger |

**Example**

```bash
open "https://<your-actor-host>/?group=main&day=2026-11-09"
```

---

### `GET /report` — JSON report

Same data as `report(day)`, without a POST round-trip.

| Query param | Type | Required | Description |
|---|---|---|---|
| `day` | `YYYY-MM-DD` | no | Defaults to today (UTC) |
| `group` | string | no | Actor instance (default `main`) |

| Status | Meaning |
|---|---|
| `200` | `Report` JSON |
| `400` | `day` failed the `YYYY-MM-DD` check |

**Example**

```bash
curl -s "https://<your-actor-host>/report?group=main&day=2026-11-09"
```

---

### `POST /rpc/<method>` — RPC dispatch

Dispatches a call to the `@rpc()` method named in the URL. The body is a **JSON array of positional arguments** (may be `[]` for no-arg methods). `?group=<name>` selects the actor instance.

```bash
curl -s -X POST "https://<your-actor-host>/rpc/sweep?group=main" \
  -H "content-type: application/json" \
  -d '["2026-11-09"]'
```

| Status | Meaning |
|---|---|
| `200` | Method returned; body is the method's JSON result |
| `400` | Malformed JSON or non-array body; the method threw a validation error (bad date, unknown profile, demo-only method in live mode) |
| `404` | Unknown method name (`/rpc/nope`); the error lists the full RPC surface |
| `405` | Non-POST request to an `/rpc/*` path |
| `500` | Upstream Telnyx failure, missing `TELNYX_API_KEY`, or SQL error |

---

## RPC methods

All five methods below are `@rpc()`-decorated on `AttributionWheel`. `nightly()` is the scheduled handler and is dispatched by name from `this.schedule()` — it is not `@rpc()`-decorated and is not intended to be called directly.

---

### `bootstrap()`

Creates the AI Gateway token group and one token key per service (`support`, `billing`, `docs`), stores the group id and masked key refs in actor state, and arms the nightly run.

Idempotent: if `state.tokenGroupId` is already set, it returns immediately with an empty `keys` map and makes no API calls.

**Request body:** none.

**Response — `200 OK`**

| Field | Type | Description |
|---|---|---|
| `tokenGroupId` | string | AI Gateway token group id (`POST /token_groups` → `data.id`) |
| `keys` | `Record<string, string>` | Full token secrets keyed by service name. **Returned once**, on first bootstrap only. Empty object on repeat calls |

```json
{
  "tokenGroupId": "tg_01J9Z8K3QW",
  "keys": {
    "support": "ltg_sk_live_9f2c...a71b",
    "billing": "ltg_sk_live_4d80...c93e",
    "docs":    "ltg_sk_live_77aa...10f5"
  }
}
```

**Side effects**

- `POST /v2/llm_token_gateway/token_groups` with `Idempotency-Key: attribution-wheel:group:<YYYY-MM-DD>`
- `POST /v2/llm_token_gateway/token_keys` ×3 with `Idempotency-Key: attribution-wheel:key:<service>`
- `setState({ tokenGroupId, keyRefs })` — `keyRefs` stores `ltg_sk_...<last7>` only, never the full secret
- `this.schedule(secondsUntil2300(), "nightly")`

| Status | Meaning |
|---|---|
| `200` | Group + keys created, or already bootstrapped |
| `500` | `TELNYX_API_KEY` missing, gateway rejected the create, or the response carried no `id` |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/rpc/bootstrap?group=main" \
  -H "content-type: application/json" \
  -d '[]'
```

---

### `sweep(day)`

The attribution run. Pulls `spend/summary` grouped by `metadata:service`, computes each service's share of the day's requests against its 7-day rolling baseline, writes one ledger row per service, and pages on-call on a new breach.

This is the **same code path** the `nightly` schedule invokes — the demo calls it directly so Day-1/Day-2 sweeps run on demand.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | string | yes | UTC date to sweep, `YYYY-MM-DD`. Must match `/^\d{4}-\d{2}-\d{2}$/` |

**Response — `200 OK`**

| Field | Type | Description |
|---|---|---|
| `day` | string | The swept date |
| `rows` | `SpendRow[]` | Rows written this run, ordered by `service` |
| `paged` | number | Number of on-call SMS actually dispatched (always `0` in demo mode) |
| `resumedFrom` | `string \| null` | Service name the run resumed after, or `null` for a fresh sweep |
| `usage` | `UsageSnapshot \| null` | Gateway `usage/summary` totals + guardrail counts for the day when a token group is bound; `null` when the call fails |

```json
{
  "day": "2026-11-09",
  "rows": [
    {
      "date": "2026-11-09",
      "service": "billing",
      "requests": 220,
      "input_tokens": 198000,
      "output_tokens": 66000,
      "spend": 0.198,
      "reserved_spend": 0,
      "unknown_requests": 0,
      "baseline_ratio": 0.49,
      "breach": 0,
      "source": "gateway",
      "note": null
    },
    {
      "date": "2026-11-09",
      "service": "support",
      "requests": 620,
      "input_tokens": 558000,
      "output_tokens": 186000,
      "spend": 0.558,
      "reserved_spend": 0,
      "unknown_requests": 0,
      "baseline_ratio": 3.1,
      "breach": 1,
      "source": "gateway",
      "note": "anomaly"
    }
  ],
  "paged": 1,
  "resumedFrom": null,
  "usage": {
    "totals": {
      "requests": 1000,
      "input_tokens": 900000,
      "output_tokens": 300000,
      "unknown_requests": 0,
      "cache_hits": 0,
      "succeeded_requests": 1000,
      "failed_requests": 0,
      "partial_requests": 0,
      "spend": 0.9,
      "reserved_spend": 0
    },
    "guardrails": { "blocked_events": 0, "flagged_events": 0 }
  }
}
```

**Breach rules** (evaluated per service, in this order)

| Condition | Result |
|---|---|
| `(share - baseline.share) * 100 >= ALERT_SHARE_PCT` (default `40` points over the service's own baseline; measured from zero when no baseline exists) | `breach = 1` |
| `spend >= baseline.spend * SPIKE_MULTIPLE` (default `2.0`) | `breach = 1` |
| `breach = 1` and no prior breach row for this service | `note = "anomaly"`, one SMS dispatched |
| `breach = 1` and the previous row for this service had `breach = 1` | `note = "continued"`, no SMS |
| `breach = 0` and the previous row for this service had `breach = 1` | `note = "recovery"`, no SMS |
| otherwise | `note = null` |

`reserved_spend` and `unknown_requests` are persisted and reported but **excluded** from share, baseline, and breach math.

**Resume semantics.** After each row is written, `setState({ lastSweepDate: day, cursor: service })`. If the pod dies mid-sweep, the next `sweep(day)` for the same day sees `lastSweepDate === day` and starts at the row *after* `cursor`. The ledger upsert is `ON CONFLICT(date, service) DO UPDATE`, so a re-run never duplicates a row.

| Status | Meaning |
|---|---|
| `200` | Sweep completed (possibly with `paged: 0`) |
| `400` | `day` failed the `YYYY-MM-DD` check |
| `500` | SQL failure, or live-mode paging with `ONCALL_E164` / `DEMO_TELNYX_NUMBER` unset |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/rpc/sweep?group=main" \
  -H "content-type: application/json" \
  -d '["2026-11-09"]'
```

---

### `report(day)`

Returns the full attribution wheel for a day: the per-service ledger plus per-tenant and per-env breakdowns pulled live from the gateway.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | string | yes | UTC date, `YYYY-MM-DD` |

**Response — `200 OK`**

| Field | Type | Description |
|---|---|---|
| `day` | string | The reported date |
| `rows` | `SpendRow[]` | Ledger rows for the day, ordered by `service` |
| `totals` | object | Sum across `rows` — see below |
| `byTenant` | `Grouped[]` | `group_by=metadata:tenant` from `spend/summary`, falling back to the local `spend_dims` ledger |
| `byEnv` | `Grouped[]` | `group_by=metadata:env` from `spend/summary`, falling back to the local `spend_dims` ledger |
| `usage` | `UsageSnapshot \| null` | Gateway `usage/summary` snapshot when available |

`totals` object:

| Field | Type | Description |
|---|---|---|
| `requests` | number | Sum of `requests` |
| `input_tokens` | number | Sum of `input_tokens` |
| `output_tokens` | number | Sum of `output_tokens` |
| `spend` | number | Sum of `spend`, rounded to 6 dp |
| `reserved_spend` | number | Sum of `reserved_spend`, rounded to 6 dp — outstanding budget holds |
| `unknown_requests` | number | Sum of `unknown_requests` — requests whose usage is not yet known |

`Grouped` object:

| Field | Type | Description |
|---|---|---|
| `value` | string | The tag value (`tenant` or `env`) |
| `requests` | number | Requests attributed to that value |
| `spend` | number | USD attributed to that value |

```json
{
  "day": "2026-11-09",
  "rows": [ /* SpendRow[] */ ],
  "totals": {
    "requests": 1000,
    "input_tokens": 900000,
    "output_tokens": 300000,
    "spend": 0.9,
    "reserved_spend": 0,
    "unknown_requests": 0
  },
  "byTenant": [{ "value": "acme", "requests": 1000, "spend": 0.9 }],
  "byEnv": [{ "value": "prod", "requests": 1000, "spend": 0.9 }],
  "usage": null
}
```

| Status | Meaning |
|---|---|
| `200` | Report returned. `byTenant`/`byEnv` fall back to the dims ledger when the gateway has no grouped rows for the day |
| `400` | `day` failed the `YYYY-MM-DD` check |
| `500` | SQL failure reading `spend_daily` |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/rpc/report?group=main" \
  -H "content-type: application/json" \
  -d '["2026-11-09"]'
```

---

### `seed(days)`

**Demo mode only.** Writes `days` of synthetic baseline history into `spend_daily` so the 7-day rolling mean has something to compare against — gateway usage cannot be backdated.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `days` | number | yes | Days of history to seed. Clamped to `[1, 30]`; non-numeric input becomes `0` → clamped to `1` |

**Response — `200 OK`**

| Field | Type | Description |
|---|---|---|
| `seeded` | number | Rows written (`3 × days` — one per service per day) |
| `profile` | string | Always `"baseline"` |

```json
{ "seeded": 21, "profile": "baseline" }
```

Rows are written with `source = "synthetic"` and `note = "seeded:baseline"` so they are never mistaken for real gateway data.

| Status | Meaning |
|---|---|
| `200` | History seeded |
| `400` | `DEMO_MODE=false` — `seed() is only available when DEMO_MODE=true` |
| `500` | SQL failure |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/rpc/seed?group=main" \
  -H "content-type: application/json" \
  -d '[7]'
```

---

### `simulate(day, profile)`

**Demo mode only.** Writes a named traffic profile for a single day, so the breach → recovery cycle can be driven without waiting for real traffic.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | string | yes | UTC date, `YYYY-MM-DD` |
| `profile` | string | yes | One of `baseline`, `spike`, `recovery` |

Profile mixes (share of the day's requests):

| Profile | `support` | `billing` | `docs` |
|---|---|---|---|
| `baseline` | 20% | 45% | 35% |
| `spike` | 62% | 22% | 16% |
| `recovery` | 18% | 47% | 35% |

**Response — `200 OK`**

| Field | Type | Description |
|---|---|---|
| `day` | string | The simulated date |
| `profile` | string | The profile applied |
| `rows` | number | Rows written (always `3`) |

```json
{ "day": "2026-11-09", "profile": "spike", "rows": 3 }
```

| Status | Meaning |
|---|---|
| `200` | Profile written |
| `400` | `DEMO_MODE=false`, bad `day` format, or `unknown profile: <name>` |
| `500` | SQL failure |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/rpc/simulate?group=main" \
  -H "content-type: application/json" \
  -d '["2026-11-09","spike"]'
```

---

### `nightly()` — scheduled handler

Dispatched by `this.schedule(secondsUntil2300(), "nightly")`. Sweeps yesterday (`todayUtc() - 1`) and re-arms itself in a `finally` block, so a failed sweep still schedules the next run.

**Request body:** none. **Response:** `void`.

Not part of the intended public surface — call `sweep(day)` instead when driving the demo.

---

## Data types

### `SpendRow`

One row of the `spend_daily` ledger. Primary key `(date, service)`.

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` (UTC) |
| `service` | string | Tag value from `metadata:service` — `support` \| `billing` \| `docs` in the demo |
| `requests` | number | Request count for the day |
| `input_tokens` | number | Prompt tokens |
| `output_tokens` | number | Completion tokens |
| `spend` | number | USD. Excludes unknown-cost requests |
| `reserved_spend` | number | USD budget hold still outstanding for requests whose usage is unknown |
| `unknown_requests` | number | Requests with null token counts. Excluded from `spend`, baseline, and breach math |
| `baseline_ratio` | number | `share / baseline.share`, 2 dp. `0` when no baseline exists |
| `breach` | `0 \| 1` | SQLite boolean |
| `source` | string | `"gateway"` (real pull) or `"synthetic"` (demo seed/simulate) |
| `note` | `string \| null` | `"anomaly"`, `"continued"`, `"recovery"`, `"seeded:<profile>"`, or `null` |

### `WheelState`

Durable actor state, merged via `setState()`.

| Field | Type | Description |
|---|---|---|
| `tokenGroupId` | `string \| null` | AI Gateway token group id; `null` before `bootstrap()` |
| `lastSweepDate` | `string \| null` | Date of the most recent sweep — drives resume detection |
| `cursor` | `string \| null` | Last service written in the current sweep; `null` between sweeps |
| `keyRefs` | `Record<string, string>` | Masked key references (`ltg_sk_...<last7>`) for the page SMS |

---

## Outbound Telnyx API calls

All calls go to `https://api.telnyx.com/v2` with `Authorization: Bearer <TELNYX_API_KEY>` from the `SECRETS` binding. Responses are unwrapped from the `{ "data": ... }` envelope.

### `POST /v2/llm_token_gateway/token_groups`

Creates the token group that scopes the whole wheel.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | `attribution-wheel-<YYYY-MM-DD>` |

Header: `Idempotency-Key: attribution-wheel:group:<YYYY-MM-DD>`.

Response: `{ "data": { "id": "tg_..." } }` → stored as `state.tokenGroupId`.

### `POST /v2/llm_token_gateway/token_keys`

Creates one inference key per service. Called three times, once per entry in `SERVICES`.

| Field | Type | Required | Description |
|---|---|---|---|
| `token_group_id` | string | yes | From the group create above |
| `name` | string | yes | `support` \| `billing` \| `docs` |

Header: `Idempotency-Key: attribution-wheel:key:<service>`.

Response: `{ "data": { "token": "ltg_sk_..." } }` (falls back to `key` if `token` is absent). The full secret is returned once from `bootstrap()`; only a masked ref is persisted.

### `GET /v2/llm_token_gateway/spend/summary`

The attribution source. Called once per sweep with `group_by=metadata:service`, and twice per report with `metadata:tenant` / `metadata:env`.

| Query param | Type | Required | Description |
|---|---|---|---|
| `start_date` | string | yes | `YYYY-MM-DD`, inclusive |
| `end_date` | string | yes | `YYYY-MM-DD`, exclusive. Range must be ≤ 31 days |
| `group_by` | string | yes | `metadata:<key>` where `<key>` is one of the five tag keys on the request |

Response rows are read from `data[]` (paginated: `page_number`/`page_size`/`has_more`); each row is normalized with `dimension_id` (the tag's text form; `null` when requests carried no such tag) as the value and `requests` / `input_tokens` / `output_tokens` / `spend` / `reserved_spend` / `unknown_requests` as numbers. A failed call is logged and degrades to the local ledger (demo) or the dims ledger (report) rather than failing the sweep.

### `GET /v2/llm_token_gateway/usage/summary`

Totals, `by_day`, `by_model`, and guardrail counts for one token group. Requires the `llm_token_gateway.usage.read` scope on the account API key.

| Query param | Type | Required | Description |
|---|---|---|---|
| `token_group_id` | string | yes | From `state.tokenGroupId` |
| `start_date` | string | yes | `YYYY-MM-DD`, inclusive |
| `end_date` | string | yes | `YYYY-MM-DD`, exclusive. Range must be ≤ 31 days |

The actor reads `data.totals` (requests, tokens, spend, reserved_spend, unknown_requests, cache/succeeded/failed/partial counts) and `data.guardrails` (blocked_events, flagged_events) into a `UsageSnapshot` surfaced on every `sweep()` and `report()` response. The ledger remains the source of truth for breach math; the usage snapshot is a live cross-check. A failed call degrades to `usage: null` rather than failing the sweep.

### `POST /v2/messages`

The on-call page. Live mode only — demo mode logs the message instead.

| Field | Type | Required | Description |
|---|---|---|---|
| `to` | string | yes | `ONCALL_E164` |
| `from` | string | yes | `DEMO_TELNYX_NUMBER` |
| `text` | string | yes | `AI spend: <service> at <N>% of 24h requests (baseline <M>%). Keys: <masked-ref>.` |

Invoked as `this.env.TELNYX.messages.send({ to, from, text })` — the platform injects auth, so no API key is passed.

### `x-ltg-metadata` request header

Attached to every inference request the demo traffic scripts send to `https://llm.telnyx.com/v1/chat/completions`.

```
x-ltg-metadata: {"service":"support","env":"prod","tenant":"acme"}
```

| Rule | Constraint |
|---|---|
| Tag count | Up to 5 per request; the demo sends exactly 3 (`service`, `env`, `tenant`) |
| Key format | 1–64 chars, `[A-Za-z0-9][A-Za-z0-9_.-]*` |
| Value types | string ≤ 256 chars, integer, or boolean |
| Reserved prefixes | `ltg_`, `telnyx_`, `litellm_`, `cf_` — rejected |
| Non-ASCII | Must be JSON-escaped |
| Error | `400 invalid_metadata` — the response never echoes the offending header |

---

## Status codes

| Code | When | Body |
|---|---|---|
| `200` | Route or RPC method completed | Method-specific JSON (see above) |
| `400` | `day` not `YYYY-MM-DD`; unknown `profile`; `seed()`/`simulate()` called with `DEMO_MODE=false`; upstream `invalid_metadata` | `{ "error": "<message>" }` |
| `404` | Unknown `/rpc/<method>` name, unknown worker path | `{ "error": "..." }` |
| `405` | Non-POST request to an `/rpc/*` route | `{ "error": "Use POST /rpc/<method> ..." }` |
| `500` | `TELNYX_API_KEY` missing from `SECRETS`; AI Gateway returned non-2xx; SQL failure; live-mode paging with `ONCALL_E164`/`DEMO_TELNYX_NUMBER` unset | `{ "error": "<generic message>" }` |

---

## Environment variables affecting the contract

| Variable | Default | Effect on responses |
|---|---|---|
| `DEMO_MODE` | `true` | `false` disables `seed()`/`simulate()` (400) and makes `sweep()` send real SMS (`paged` > 0) |
| `ALERT_SHARE_PCT` | `40` | Share jump (percentage points) over the service's own baseline that sets `breach = 1` |
| `SPIKE_MULTIPLE` | `2.0` | Spend-vs-baseline multiplier that sets `breach = 1` |
| `ONCALL_E164` | — | SMS recipient; required only when `DEMO_MODE=false` |
| `DEMO_TELNYX_NUMBER` | — | SMS sender; required only when `DEMO_MODE=false` |
| `AI_GATEWAY_MODEL` | `Kimi-K3` | Model used by the demo traffic scripts (not read by the actor) |
| `TELNYX_API_KEY` | — | Secret binding; missing → every gateway call returns `500` |
