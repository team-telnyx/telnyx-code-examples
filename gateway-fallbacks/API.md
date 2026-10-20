# API Reference — AI Gateway Fallback & Resilience Desk

Typed reference for every AI Gateway surface the five demo scripts touch. Management-plane calls go through the Telnyx Python SDK (`client.llm_token_gateway.*`, base `https://api.telnyx.com/v2`, account API key); inference-plane calls go through the OpenAI SDK pointed at `https://llm.telnyx.com/v1` with the token key and `max_retries=0`.

## Management plane — `llm_token_gateway`

### `POST /llm_token_gateway/token_groups`

Create the token group that encodes the failover policy.

**Request**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Demo uses `gateway-fallbacks-demo` |
| `allowed_models` | string[] | yes | Every key and fallback alias must be listed |
| `fallbacks` | map primary → ordered string[] | no | Chains of 1-3 aliases, all in `allowed_models`, no duplicates, never self-referencing |
| `retries` | object | no | `max_attempts` (1-5), `retry_delay_ms` (0-5000, default 250), `backoff` (`constant`\|`linear`\|`exponential`), `request_timeout_ms`; `max_attempts × (1 + longest chain) ≤ 8`, else **400** |
| `max_budget` | number | no | USD, ≤ 6 decimal places; parsed exactly to integer micro-USD |
| `budget_duration` | enum | no | `"1d"` in this demo |
| `cache_ttl` | int | no | Seconds; patched in the cache demo |
| `idempotency_key` | header | yes | Supplied by the SDK from the `idempotency_key` argument |

**Response `data` (TokenGroup)**

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Group ID (`grp_...`) |
| `allowed_models` | string[] | Echoed |
| `fallbacks` | map\|null | Stored form |
| `retries` | object\|null | Stored form, defaults filled in |
| `max_budget`, `budget_duration` | number / enum | Budget window |
| `spend`, `reserved_spend` | number | Realized spend and the reservation for planned attempts (released at settlement) |
| `cache_ttl` | int\|null | Present after the cache demo |
| `version` | int | Bumps on every mutation (`If-Match` optimistic concurrency) |

**Errors:** `400 invalid_request` for out-of-contract configs (chain depth > 3, `max_attempts` outside 1-5, attempt math > 8, unknown aliases, self-reference, duplicates).

### `POST /llm_token_gateway/token_keys`

Issue a key scoped to the group. **The token secret is returned only on the original create response** — a replayed (same `Idempotency-Key`) request returns metadata without the secret.

**Request**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Demo uses `gateway-fallbacks-key` |
| `token_group_id` | string | yes | Group from the previous call |

**Response `data` (TokenKey)** — all standard fields, plus the one-time secret as an untyped field on the create response (read via `model_extra` in `provision.py`; the SDK's typed model intentionally omits it because it is never returned again).

### `GET /llm_token_gateway/token_groups/{id}` · `GET /llm_token_gateway/token_keys/{id}`

Read group/key state and — via the SDK's `with_raw_response` accessor — the `ETag` response header, which every subsequent PATCH/DELETE must echo as `If-Match`.

### `PATCH /llm_token_gateway/token_groups/{id}`

Partial group update. Omitted fields are preserved; a stale `If-Match` returns **412**.

| Field | Type | Demo use |
|-------|------|----------|
| `cache_ttl` | int | Set to `60` to enable the cache-hit demo |
| `retries` | object | Sent with `max_attempts: 9` to prove the **400** invalid-config rejection |
| `If-Match` | header | ETag from the preceding GET |
| `Idempotency-Key` | header | Unique per mutation |

### `DELETE /llm_token_gateway/token_keys/{id}` · `DELETE /llm_token_gateway/token_groups/{id}`

Revoke the key (blocks new admissions; already-admitted requests may complete) and delete the group (revokes its keys atomically; historical attribution is retained). Both require `If-Match` + `Idempotency-Key`; foreign/unknown IDs return the same 404 shape.

### `GET /llm_token_gateway/spend/events`

Request-level usage history; half-open UTC range `[start_date, end_date)` of at most 31 days.

**Query**

| Param | Type | Notes |
|-------|------|-------|
| `start_date`, `end_date` | date | Supply both or neither (defaults to the previous full UTC day) |
| `token_key_id` | string | Filter for the demo key |
| `page_number`, `page_size` | int | Snapshot pagination |
| `page_snapshot` | string | Required after page 1; account/filter-bound 15-minute stable snapshot (mismatch → 409) |

**Response `data[]` (spend event)**

| Field | Type | Notes |
|-------|------|-------|
| `requested_model` | string | Public alias the caller requested; differs from `model` only when a group fallback served |
| `model` | string | Public alias that served (the last attempt) |
| `attempts` | int | Provider attempts begun for the request (fallbacks included); **0 for a cache hit** |
| `status` | enum | `succeeded` \| `failed` \| `partial` \| `unknown` |
| `cache_hit` | bool | True when served from cache |
| `cost`, `reservation_micro_usd` | number/int | Budget reference rates, not invoice charges |
| `request_id`, `token_key_id`, `token_group_id`, `created_at` | — | Identity and ordering |

**Response `meta`**: `has_more`, `page_number`, `page_size`, `snapshot`.

### `GET /llm_token_gateway/usage/summary`

Combined group dashboard. Requires the dedicated `llm_token_gateway.usage.read` V2 action — `spend.read`/`guardrail_events.read` grants do **not** grant this endpoint, so a 403 is expected on narrower accounts and is a documented, non-fatal warning in `ledger.py`.

**Query:** `start_date`, `end_date`, `token_group_id`, optional `metadata[<key>]=<value>` filters (≤ 5).

**Response `data`**: `totals` (requests, `input_tokens`, `output_tokens`, `cache_hits`, `failed_requests`, `spend`, `reserved_spend`), `by_day[]`, `by_model[]`, `guardrails` (`blocked_events`, `flagged_events`, `recent_events`).

## Inference plane — OpenAI-compatible

Base URL `https://llm.telnyx.com/v1`; authenticate with the **token key** only (the gateway rejects account keys here).

### `GET /v1/models`

Model discovery scoped to the calling token key — the key-scoped view of the group's `allowed_models`. `inference.py` lists this before any chat call.

### `POST /v1/chat/completions`

OpenAI Chat Completions shape. The client MUST be built with `max_retries=0`: SDK retries are additional requests on top of gateway attempts — they double-bill and inflate attempt counts.

**Request highlights**

| Field | Notes |
|-------|-------|
| `model` | Primary alias (`Kimi-K3` in the demo) |
| `messages`, `max_tokens` | Standard |
| `stream` | Streaming is required for the forced-failure mechanism (timeout applies per attempt to the first provider event) |

**Extra request headers (per-request overlay)**

| Header | Demo value | Effect |
|--------|-----------|--------|
| `x-ltg-request-timeout` | `1000` | Bounds each *streaming* attempt's time to its first provider event; the forced-failure trigger |
| `x-ltg-max-attempts` | `1` | Tightens the attempt ceiling for this one request |
| `x-ltg-retry-delay` | `100` | Retry-delay floor for this request (ms) |
| `x-ltg-backoff` | `constant` | Retry backoff curve for this request |

**Response**

| Field / Header | Notes |
|----------------|-------|
| `model` (body) | The alias that actually served |
| `x-ltg-served-model` (header) | Same story, on the live path — the fallback's name appears here when failover fired |
| `x-ltg-attempts` (header) | Number of attempts; **`0` on a cache hit** |

On streaming requests the headers ride the initial response; `gateway.chat_completion` reads them via the SDK's `with_raw_response` accessor before consuming the stream.

**Errors:** `401` for a revoked or missing token key (the post-revocation proof in `teardown.py` asserts this), `429`/`529` definite no-work (same-step retry), `408`/`5xx` uncertain (fallback step), context-length rejection is terminal.

## Local dashboard (optional) — `dashboard.py`

Presentation glue for the five-script demo; not part of the acceptance surface. Binds to `127.0.0.1:8079` by default (`PORT` overrides). The token key is read only from the `GATEWAY_TOKEN_KEY` environment variable — never accepted from, or returned in, any HTTP request/response. Errors return generic messages; details go to the server log.

### `GET /`

Serves `dashboard.html` (single page, no build step, no external assets).

### `GET /api/state`

Live snapshot for the UI poll (every 3 s).

**Response**

| Field | Type | Notes |
|-------|------|-------|
| `status` | string | `ready` \| `unprovisioned` \| `error` |
| `group` | object | `id`, `allowed_models`, `fallbacks`, `retries`, `spend`, `reserved_spend`, `max_budget`, `budget_duration`, `cache_ttl` |
| `token_key_present` | bool | Whether actions are enabled (the key itself is never included) |
| `window` | object | `start_date`, `end_date` of the ledger query |
| `events[]` | object[] | Serialized spend events, newest first: `created_at`, `requested_model`, `model`, `attempts`, `status`, `cache_hit`, `cost`, `is_failover` (`requested_model ≠ model`) |
| `usage` | object | Totals + `by_model`, or `{"warning": ...}` when the summary call is denied (403) |

`unprovisioned` responses include `instructions` pointing at `provision.py`.

### `POST /api/actions/normal-call`

Fires one non-stream completion against the primary using the server-side env token key.

**Response:** `{ "result": { "model", "x-ltg-served-model", "x-ltg-attempts", "streamed": false } }` · **Errors:** `400` when `GATEWAY_TOKEN_KEY` is unset; `502` with a generic message when the call fails.

### `POST /api/actions/force-failure`

Runs the forced-failure routine from `inference.py` (streaming, `x-ltg-request-timeout: 1000`, up to 3 tries).

**Response:** `{ "outcome": { "ok": bool, "tries": int, "result": { "model", "x-ltg-served-model", "x-ltg-attempts", "streamed": true } } }` — `ok: true` means the fallback actually served; `ok: false` is the honest no-failover report. Same error semantics as the normal-call route.

### `GET /<anything else>`

`404 {"error": "not found"}`.
