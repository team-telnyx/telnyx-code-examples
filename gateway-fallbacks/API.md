# API Reference — AI Gateway Fallback & Resilience Desk

Typed contract for every HTTP route exposed by `app.py`. All routes are JSON-in / JSON-out unless noted. The Flask service is a thin wrapper over the five demo scripts (`provision.py`, `inference.py`, `ledger.py`, `policy.py`, `teardown.py`); the same functions are importable for CLI use.

Base URL (local): `http://localhost:8080`

---

## Conventions

| Item | Value |
| --- | --- |
| Content type | `application/json` |
| Auth | None on the Flask layer. Upstream calls use `TELNYX_API_KEY` (management plane) and the issued token key (inference plane). |
| Error shape | `{"error": "<generic message>"}` — exception detail is logged server-side, never returned. |
| Demo mode | `DEMO_MODE=true` (default) short-circuits real spend. See `GUIDE.md`. |

---

## `GET /health`

Liveness probe. Reports whether the service is running and which mode it is in.

### Request

No body, no parameters.

### Example

```bash
curl -s http://localhost:8080/health
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | Always `"ok"` when the process is up. |
| `demo_mode` | boolean | `true` when `DEMO_MODE=true`; `false` when live calls are enabled. |

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Service is up. |
| 500 | Unhandled server error (should not occur on this route). |

---

## `POST /provision`

Creates the AI Gateway token group (`POST /token_groups`) with `allowed_models`, `fallbacks`, and `retries`, then issues a scoped token key (`POST /token_keys`). The token secret is printed **exactly once** to stdout and is never returned in the HTTP response or persisted.

Policy constraints are asserted before the API call: chain depth ≤ 3, `max_attempts` 1–5, and `max_attempts × (1 + longest chain) ≤ 8`. Invalid configs raise before any network call.

### Request body

No fields are required. The group is built from environment configuration (`PRIMARY_MODEL`, `FALLBACK_MODEL`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| *(none)* | — | — | Provisioning parameters come from env vars. |

### Example

```bash
curl -s -X POST http://localhost:8080/provision
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `group_id` | string | ID of the created token group. |
| `key_id` | string | ID of the issued token key. |
| `secret_shown_once` | boolean | Always `true`; the secret was emitted to stdout only. |

```json
{
  "group_id": "tg_01H...",
  "key_id": "tk_01H...",
  "secret_shown_once": true
}
```

**500 Internal Server Error**

```json
{ "error": "provision failed" }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Group and key created; secret printed once to stdout. |
| 400 | Upstream rejected the policy payload (invalid `fallbacks` / `retries`). |
| 500 | Provisioning failed (upstream error, network, or policy assertion). |

---

## `POST /inference`

Runs the inference-plane demo against `https://llm.telnyx.com/v1` using the OpenAI SDK with `max_retries=0`. Performs three steps:

1. Lists key-scoped models (`GET /v1/models`) to prove `allowed_models` names are real.
2. Sends a normal chat completion and reports `model` plus the `x-ltg-served-model` / `x-ltg-attempts` headers.
3. Runs the **forced-failure** path: a streaming request against the primary model with the overlay header `x-ltg-request-timeout: 1000` and a deliberately heavy prompt. The primary's first provider event misses the 1 s deadline → timeout → the gateway moves to the fallback. The run asserts `x-ltg-served-model == FALLBACK_MODEL` and `x-ltg-attempts >= 2`, retrying up to 3 times with progressively heavier prompts.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `token_key` | string | **yes** | The token key secret issued by `POST /provision`. Inference-plane credential only. |

### Example

```bash
curl -s -X POST http://localhost:8080/inference \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "tk_live_..."}'
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `models` | string[] | Model IDs visible to the calling key. |
| `normal` | object | Result of the normal chat completion. |
| `normal.model` | string | Model reported by the OpenAI SDK response. |
| `normal.x-ltg-served-model` | string \| null | Gateway-served model header. |
| `normal.x-ltg-attempts` | string \| null | Gateway attempt count header. |
| `normal.streamed` | boolean | `false` for the normal call. |
| `forced_failure` | object | Result of the forced-failure run. |
| `forced_failure.ok` | boolean | `true` when the fallback was served with `attempts >= 2`. |
| `forced_failure.result` | object | Last attempt's `model` / `x-ltg-served-model` / `x-ltg-attempts` / `streamed`. |
| `forced_failure.tries` | integer | Number of heavy-prompt attempts used (1–3). |

```json
{
  "models": ["Kimi-K3", "GLM-5.3-Flash"],
  "normal": {
    "model": "Kimi-K3",
    "x-ltg-served-model": "Kimi-K3",
    "x-ltg-attempts": "1",
    "streamed": false
  },
  "forced_failure": {
    "ok": true,
    "result": {
      "model": "GLM-5.3-Flash",
      "x-ltg-served-model": "GLM-5.3-Flash",
      "x-ltg-attempts": "2",
      "streamed": true
    },
    "tries": 1
  }
}
```

**400 Bad Request**

```json
{ "error": "token_key required" }
```

**500 Internal Server Error**

```json
{ "error": "inference failed" }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Inference completed; headers captured. `forced_failure.ok` may still be `false` if the primary answered inside 1 s on all three tries — reported honestly. |
| 400 | `token_key` missing from the request body. |
| 500 | Inference call failed (auth, network, or upstream error). |

---

## `GET /ledger`

Reads the spend ledger (`GET /spend/events`) for a token key over a half-open UTC date range `[start_date, end_date)`. Each row compares `requested_model` against the serving `model` and reports `attempts` — the ledger records the same failover the response headers showed.

### Query parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `token_key_id` | string | **yes** | Token key ID from `POST /provision`. |
| `start_date` | string (ISO date) | **yes** | Inclusive start of the range, UTC. |
| `end_date` | string (ISO date) | **yes** | Exclusive end of the range, UTC. |

### Example

```bash
curl -s 'http://localhost:8080/ledger?token_key_id=tk_01H...&start_date=2026-07-01&end_date=2026-07-02'
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `events` | object[] | Spend-event rows for the key and range. |
| `events[].requested_model` | string | Model the caller asked for. |
| `events[].model` | string | Model that actually served the request. |
| `events[].attempts` | integer | Attempts consumed by the gateway. |
| `events[].status` | string | Terminal status of the request. |
| `events[].cache_hit` | boolean | `true` when served from cache. |

```json
{
  "events": [
    {
      "requested_model": "Kimi-K3",
      "model": "GLM-5.3-Flash",
      "attempts": 2,
      "status": "success",
      "cache_hit": false
    }
  ]
}
```

**400 Bad Request**

```json
{ "error": "token_key_id, start_date, end_date required" }
```

**500 Internal Server Error**

```json
{ "error": "ledger failed" }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Ledger rows returned (may be an empty array). |
| 400 | One or more required query parameters missing. |
| 500 | Ledger read failed (upstream error or network). |

---

## `POST /policy`

Demonstrates the per-request overlay headers (`x-ltg-max-attempts`, `x-ltg-retry-delay`, `x-ltg-backoff`) that tighten the group policy for a single request without a group PATCH. Sends one chat completion against the primary model with the overlay applied.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `token_key` | string | **yes** | The token key secret issued by `POST /provision`. |

### Example

```bash
curl -s -X POST http://localhost:8080/policy \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "tk_live_..."}'
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `overlay` | object | Result of the overlay-constrained call. |
| `overlay.model` | string | Model reported by the SDK. |
| `overlay.x-ltg-served-model` | string \| null | Gateway-served model header. |
| `overlay.x-ltg-attempts` | string \| null | Attempt count under the tightened policy. |
| `overlay.streamed` | boolean | `false` for the overlay call. |

```json
{
  "overlay": {
    "model": "Kimi-K3",
    "x-ltg-served-model": "Kimi-K3",
    "x-ltg-attempts": "1",
    "streamed": false
  }
}
```

**400 Bad Request**

```json
{ "error": "token_key required" }
```

**500 Internal Server Error**

```json
{ "error": "policy failed" }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Overlay call completed. |
| 400 | `token_key` missing from the request body. |
| 500 | Overlay call failed (auth, network, or upstream error). |

---

## `POST /teardown`

Revokes the token key (`DELETE /token_keys/{id}`) and deletes the token group (`DELETE /token_groups/{id}`), both using the docs' mutation-safety pattern: `If-Match: <ETag>` plus an `Idempotency-Key`. After revocation, the next inference call with the revoked key is rejected by the gateway.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `key_id` | string | **yes** | Token key ID to revoke. |
| `key_etag` | string | **yes** | Current ETag for the key (from the last GET/POST response). |
| `group_id` | string | **yes** | Token group ID to delete. |
| `group_etag` | string | **yes** | Current ETag for the group. |

### Example

```bash
curl -s -X POST http://localhost:8080/teardown \
  -H 'Content-Type: application/json' \
  -d '{
    "key_id": "tk_01H...",
    "key_etag": "\"abc123\"",
    "group_id": "tg_01H...",
    "group_etag": "\"def456\""
  }'
```

### Response

**200 OK**

| Field | Type | Description |
| --- | --- | --- |
| `revoked` | boolean | `true` when both the key and group were removed. |

```json
{ "revoked": true }
```

**400 Bad Request**

```json
{ "error": "key_id, key_etag, group_id, group_etag required" }
```

**500 Internal Server Error**

```json
{ "error": "teardown failed" }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Key revoked and group deleted. |
| 400 | One or more required body fields missing. |
| 404 | Upstream reports the key or group no longer exists (already torn down). |
| 500 | Teardown failed (ETag mismatch, upstream error, or network). |

---

## Error model

All error responses share the same shape:

```json
{ "error": "<generic message>" }
```

| Status | When it is returned |
| --- | --- |
| 400 | Missing or malformed request input (body field or query parameter). |
| 404 | Upstream resource not found (e.g. teardown of an already-deleted key/group). |
| 500 | Any unhandled failure — upstream API error, network failure, or policy assertion. Exception detail is logged via `app.logger.exception(...)` and never returned to the client. |

---

## Upstream endpoints exercised

The Flask routes proxy to these Telnyx endpoints. They are documented here for traceability; the client never calls them directly.

| Plane | Endpoint | Used by |
| --- | --- | --- |
| Management | `POST /token_groups` | `POST /provision` |
| Management | `POST /token_keys` | `POST /provision` |
| Management | `PATCH /token_groups/{id}` | `patch_cache_ttl()` (cache_ttl demo) |
| Management | `GET /spend/events` | `GET /ledger` |
| Management | `GET /usage/summary` | `usage_summary()` (non-fatal on 403) |
| Management | `DELETE /token_keys/{id}` | `POST /teardown` |
| Management | `DELETE /token_groups/{id}` | `POST /teardown` |
| Inference | `GET /v1/models` | `POST /inference` |
| Inference | `POST /v1/chat/completions` | `POST /inference`, `POST /policy` |

Management-plane calls go to `TELNYX_MGMT_BASE` (default `https://api.telnyx.com/v2/llm_token_gateway`) with the account key. Inference-plane calls go to `TELNYX_INFER_BASE` (default `https://llm.telnyx.com/v1`) with the token key only — the gateway rejects account keys on the inference plane.

---

## Response headers observed

These headers are read from the inference-plane responses and surfaced in the JSON bodies above. They are the observability contract for failover.

| Header | Direction | Meaning |
| --- | --- | --- |
| `x-ltg-served-model` | response | The model that actually served the request. |
| `x-ltg-attempts` | response | Number of attempts the gateway consumed. |
| `x-ltg-max-attempts` | request overlay | Tightens `max_attempts` for one request. |
| `x-ltg-retry-delay` | request overlay | Tightens `retry_delay_ms` for one request. |
| `x-ltg-backoff` | request overlay | Overrides backoff strategy for one request. |
| `x-ltg-request-timeout` | request overlay | Streaming-only timeout (1000–60000 ms) applied until the first provider event. |
=== END FILE ===
