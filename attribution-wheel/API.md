# API Reference — `attribution-wheel`

Typed contract for the three surfaces this sample exposes or consumes:

1. **Edge HTTP routes** on the deployed worker (`src/index.ts` default export).
2. **Actor RPC methods** on the `AttributionWheel` agent (public async methods, auto-callable from a stub).
3. **Outbound Telnyx API calls** the actor makes (AI Gateway token groups/keys, spend + usage summaries, Messaging).

---

## Transport & conventions

| Item | Value |
|---|---|
| Base URL (worker) | `https://<your-actor-host>` (assigned by `telnyx-edge ship`) |
| Content type | `application/json` |
| Actor addressing | `?group=<name>` query param on the worker URL; defaults to `main` |
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

Liveness probe. Does not touch the actor, the database, or the Telnyx API.

**Request body:** none.

**Response — `200 OK`**

```json
{ "ok": true, "actor": "AttributionWheel" }
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

### `ANY /` — actor proxy

Every non-`/health` request is forwarded verbatim to the `AttributionWheel` stub selected by `?group=`:

```ts
const name = url.searchParams.get("group") ?? "main";
const stub = env.WHEELS.get(env.WHEELS.idFromName(name));
return stub.fetch(request);
```

The runtime dispatches the request to a public method on the actor. From another actor or a test, call the stub directly (`stub.sweep("2026-11-09")`) — that path skips HTTP entirely and is the canonical way to drive the demo.

**Query parameters**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `group` | string | no | `main` | Actor name passed to `idFromName`. Use one name per token group so the ledger and baseline stay scoped to that group |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"bootstrap","params":[]}'
```

| Status | Meaning |
|---|---|
| `200` | Method returned |
| `400` | Method threw a validation error (bad date, unknown profile, demo-only method in live mode) |
| `404` | No such RPC method on `AttributionWheel` |
| `500` | Upstream Telnyx failure, missing `TELNYX_API_KEY`, or SQL error |

---

## RPC methods

All five methods below are `public async` on `AttributionWheel` and therefore part of the RPC surface. `nightly()` is the scheduled handler and is dispatched by name from `this.schedule()` — it is not intended to be called directly, but it is reachable through the same proxy.

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
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"bootstrap","params":[]}'
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
  "resumedFrom": null
}
```

**Breach rules** (evaluated per service, in this order)

| Condition | Result |
|---|---|
| `share * 100 >= ALERT_SHARE_PCT` (default `40`) | `breach = 1` |
| `spend >= baseline.spend * SPIKE_MULTIPLE` (default `2.0`) | `breach = 1` |
| `breach = 1` and no prior breach row for this service | `note = "anomaly"`, one SMS dispatched |
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
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"sweep","params":["2026-11-09"]}'
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
| `byTenant` | `Grouped[]` | `group_by=metadata:tenant` from `spend/summary`; `[]` if the call fails |
| `byEnv` | `Grouped[]` | `group_by=metadata:env` from `spend/summary`; `[]` if the call fails |

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
  "byEnv": [{ "value": "prod", "requests": 1000, "spend": 0.9 }]
}
```

| Status | Meaning |
|---|---|
| `200` | Report returned. `byTenant`/`byEnv` may be empty if the gateway call failed — the ledger portion is still valid |
| `400` | `day` failed the `YYYY-MM-DD` check |
| `500` | SQL failure reading `spend_daily` |

**Example**

```bash
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"report","params":["2026-11-09"]}'
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
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"seed","params":[7]}'
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
curl -s -X POST "https://<your-actor-host>/?group=main" \
  -H "content-type: application/json" \
  -d '{"method":"simulate","params":["2026-11-09","spike"]}'
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
| `note` | `string \| null` | `"anomaly"`, `"recovery"`, `"seeded:<profile>"`, or `null` |

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

Response rows are read from `data.rows[]` or `data[]`; each row is normalized with `group` (or the tag key) as the value and `requests` / `input_tokens` / `output_tokens` / `spend` / `reserved_spend` / `unknown_requests` as numbers. A failed call is logged and degrades to the local ledger (demo) or an empty result (report) rather than failing the sweep.

### `GET /v2/llm_token_gateway/usage/summary`

Totals, `by_day`, `by_model`, and guardrail counts. Requires the `llm_token_gateway.usage.read` scope on the account API key. Used for cross-checking the spend pull; the ledger remains the source of truth for breach math.

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
| `404` | No such RPC method on `AttributionWheel`, or unknown worker path forwarded to the stub | `{ "error": "not found" }` |
| `500` | `TELNYX_API_KEY` missing from `SECRETS`; AI Gateway returned non-2xx; SQL failure; live-mode paging with `ONCALL_E164`/`DEMO_TELNYX_NUMBER` unset | `{ "error": "<generic message>" }` |

---

## Environment variables affecting the contract

| Variable | Default | Effect on responses |
|---|---|---|
| `DEMO_MODE` | `true` | `false` disables `seed()`/`simulate()` (400) and makes `sweep()` send real SMS (`paged` > 0) |
| `ALERT_SHARE_PCT` | `40` | Share-of-requests threshold that sets `breach = 1` |
| `SPIKE_MULTIPLE` | `2.0` | Spend-vs-baseline multiplier that sets `breach = 1` |
| `ONCALL_E164` | — | SMS recipient; required only when `DEMO_MODE=false` |
| `DEMO_TELNYX_NUMBER` | — | SMS sender; required only when `DEMO_MODE=false` |
| `AI_GATEWAY_MODEL` | `Kimi-K3` | Model used by the demo traffic scripts (not read by the actor) |
| `TELNYX_API_KEY` | — | Secret binding; missing → every gateway call returns `500` |
