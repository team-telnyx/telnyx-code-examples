# API Reference — Number Lifecycle Porter

All endpoints are HTTP POST handlers exposed by the default fetch handler in `src/index.ts`. Each endpoint resolves a durable `NumberActor` instance via `env.NUMBERS.idFromName(areaCode:tag)` and dispatches an `@rpc` method on the actor stub.

---

## POST /health

Lightweight liveness probe for the Edge Worker itself (does not touch any actor).

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | No body required. |

### Example

```bash
curl -X GET https://<worker-url>/health
```

### Response

| Status | JSON Shape |
|--------|------------|
| `200 OK` | `{ "status": "ok", "service": "number-lifecycle-porter" }` |

---

## POST /provision

Triggers the `provision(areaCode, features)` RPC on the `NumberActor`. This is the entry point for the full number lifecycle: search → order → poll → wire → announce.

### Query Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `areaCode` | string | No | `AREA_CODE` env var | 3-digit NANP area code to search within. Must match `^\d{3}$`. |
| `features` | string | No | `voice,sms` | Comma-separated list of desired features (e.g. `voice,sms`). |

### Request Body

None.

### Example

```bash
curl -X POST "https://<worker-url>/provision?areaCode=415&features=voice,sms"
```

### Response

| Status | JSON Shape |
|--------|------------|
| `200 OK` | `{ "e164": "+1415XXXXXXX", "orderId": "order_abc123", "stage": "ordered" }` |
| `400 Bad Request` | `{ "error": "Invalid area code: must be 3 digits" }` |
| `500 Internal Server Error` | `{ "error": "Search failed: 401 Unauthorized" }` *(or other Telnyx API error)* |

### Notes

- **Idempotent**: If the actor already has an `orderId` and `e164` in durable state, the existing values are returned without re-searching or re-ordering.
- **Demo mode** (`DEMO_MODE=true`): Returns a simulated E.164 number and a deterministic `order_demo_<digits>` order ID. No real Telnyx API calls are made.
- **Live mode** (`DEMO_MODE=false`): Calls `GET /v2/available_phone_numbers` then `POST /v2/number_orders`. A poll timer is scheduled via `this.schedule(POLL_INTERVAL_SECS, 'pollOrder')`.

---

## POST /rollback

Triggers the `rollback()` RPC on the `NumberActor`. Reverts the wired number's `connection_id` to `null`, sends a revert SMS to `OPS_SMS_TO`, and marks the actor stage as `rolled_back`.

### Query Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `areaCode` | string | No | `AREA_CODE` env var | 3-digit area code identifying the actor to roll back. |

### Request Body

None.

### Example

```bash
curl -X POST "https://<worker-url>/rollback?areaCode=415"
```

### Response

| Status | JSON Shape |
|--------|------------|
| `200 OK` | `{ "success": true, "message": "Rolled back number +1415XXXXXXX" }` |
| `200 OK` | `{ "success": false, "message": "Number not in announced state; nothing to roll back" }` |
| `500 Internal Server Error` | `{ "error": "Revert failed: 500 Internal Server Error" }` |

### Notes

- Only succeeds if the actor's stage is `announced`. If the number was never provisioned or is already rolled back, returns `success: false`.
- **Demo mode**: Logs the revert action; no real `PATCH /v2/phone_numbers/{id}` call is made.
- **Live mode**: Performs `GET /v2/phone_numbers?filter[phone_number]=...` to resolve the phone number ID, then `PATCH /v2/phone_numbers/{id}` with `connection_id: null` and `tags: ["rolled-back"]`.

---

## POST /retire

Triggers the `retire()` RPC on the `NumberActor`. Releases the number from the Call Control app by setting `connection_id` to `null` and tags to `["retired"]`.

### Query Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `areaCode` | string | No | `AREA_CODE` env var | 3-digit area code identifying the actor to retire. |

### Request Body

None.

### Example

```bash
curl -X POST "https://<worker-url>/retire?areaCode=415"
```

### Response

| Status | JSON Shape |
|--------|------------|
| `200 OK` | `{ "success": true, "message": "Retired number +1415XXXXXXX" }` |
| `200 OK` | `{ "success": false, "message": "No number to retire" }` |
| `500 Internal Server Error` | `{ "error": "Release failed: 500 Internal Server Error" }` |

### Notes

- **Demo mode**: Logs the release action; no real Telnyx API call is made.
- **Live mode**: Resolves the phone number ID via `GET /v2/phone_numbers?filter[phone_number]=...`, then `PATCH /v2/phone_numbers/{id}` with `connection_id: null` and `tags: ["retired"]`.
- The number is **not deleted** from Telnyx — it is only un-wired from the Call Control app.

---

## Actor RPC Methods (Internal)

These methods are callable via the `NumberActor` stub from within the Edge Worker or from other actors. They are not directly exposed as HTTP endpoints but are invoked through the default fetch handler above.

### `provision(areaCode: string, features: string[]): Promise<{ e164, orderId, stage }>`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `areaCode` | string | Yes | 3-digit NANP area code. |
| `features` | string[] | No | Array of feature strings (e.g. `["voice", "sms"]`). Defaults to `["voice", "sms"]`. |

**Returns**: `{ e164: string, orderId: string, stage: string }`

### `pollOrder(): Promise<void>`

Scheduled task (via `this.schedule()`). Polls `GET /v2/number_orders/{orderId}` until status is `success`, `failure`, or `cancelled`. On `success`, proceeds to wire-up, announce, and log events. On `pending`, re-arms the poll timer with backoff.

### `rollback(): Promise<{ success: boolean, message: string }>`

Reverts the wired number and sends a revert SMS.

### `retire(): Promise<{ success: boolean, message: string }>`

Releases the number from the Call Control app.

### `fetch(req: Request): Promise<Response>`

Actor-level HTTP handler. Responds to `GET /health` with current actor state.

---

## Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| `200` | OK | Successful RPC dispatch and execution. |
| `400` | Bad Request | Invalid `areaCode` parameter (not 3 digits). |
| `404` | Not Found | Unknown route path. |
| `500` | Internal Server Error | Telnyx API error, actor state error, or unhandled exception. |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes (live mode) | Telnyx API key, stored as a secret. |
| `CC_APP_CONNECTION_ID` | Yes | Call Control app resource ID to wire numbers to. |
| `OPS_SMS_TO` | Yes | On-call phone number to receive cutover/revert SMS. |
| `NEW_NUMBER_TAG` | Yes | Tag prefix for the new number (e.g. `clinic-north`). |
| `POLL_INTERVAL_SECS` | No | Poll interval in seconds. Default: `30`. |
| `POLL_MAX_MINUTES` | No | Maximum poll duration in minutes. Default: `60`. |
| `AREA_CODE` | No | Default area code for search. Default: `415`. |
| `DEMO_MODE` | No | `true` (default) for simulated mode; `false` for live Telnyx API calls. |

---

## Telnyx API Endpoints Used (Internal)

| Method | Telnyx API | Purpose |
|--------|------------|---------|
| `GET` | `/v2/available_phone_numbers` | Search for available numbers by area code + features. |
| `POST` | `/v2/number_orders` | Create a number order for the selected E.164. |
| `GET` | `/v2/number_orders/{id}` | Poll order status until `success` / `failure` / `cancelled`. |
| `GET` | `/v2/phone_numbers?filter[phone_number]=...` | Resolve phone number ID for wire-up / revert / release. |
| `PATCH` | `/v2/phone_numbers/{id}` | Wire number to Call Control app (`connection_id` + `tags`). |
| `POST` | `[telnyx] messages.send()` | Send cutover and revert SMS via the zero-credential Telnyx binding. |

---

## SQL Schema (ORDERS_DB)

The actor persists audit data in a SQL database binding (`ORDERS_DB`).

### `orders` table

| Column | Type | Description |
|--------|------|-------------|
| `order_id` | TEXT (PK) | Telnyx number order ID (or `order_demo_<digits>` in demo mode). |
| `status` | TEXT | Current order status: `pending`, `success`, `failure`, `cancelled`. |
| `poll_count` | INTEGER | Number of poll attempts (demo mode only). |
| `created_at` | INTEGER | Unix timestamp (ms) of order creation. |

### `events` table

| Column | Type | Description |
|--------|------|-------------|
| `number` | TEXT | E.164 number or area code identifier. |
| `stage` | TEXT | Lifecycle stage: `search`, `order`, `wire`, `announce`, `rollback`, `retire`. |
| `at` | INTEGER | Unix timestamp (ms) of the event. |
