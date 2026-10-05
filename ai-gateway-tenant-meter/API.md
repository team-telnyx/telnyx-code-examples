# API Reference — `ai-gateway-tenant-meter`

Typed endpoint reference for the Telnyx Edge multi-tenant AI spend ledger. All routes are HTTP endpoints served by the Edge Worker entry point (`src/index.ts`). RPC methods on the `SpendLedger` actor are invoked internally via the `LEDGERS` actor namespace and are **not** directly exposed as HTTP routes.

---

## `POST /provision`

Provisions a new tenant ledger: creates a Telnyx AI Gateway token group (with budget + guardrails) and a primary token key, then returns the gateway base URL and identifiers.

### Request Body

| Field           | Type    | Required | Description                                                                 |
|-----------------|---------|----------|-----------------------------------------------------------------------------|
| `tenantId`      | string  | yes      | Unique tenant identifier (max 128 chars). Used as the token group name.     |
| `monthlyBudget` | number  | yes      | Monthly AI spend budget in USD. Must be > 0 and ≤ 100000.                   |

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
  "gatewayBaseUrl": "https://api.telnyx.com/v2/llm_token_gateway/token_groups/tg_abc123",
  "tokenGroupId": "tg_abc123",
  "tokenKeyId": "tk_def456"
}
```

| Field            | Type   | Description                                                        |
|------------------|--------|--------------------------------------------------------------------|
| `gatewayBaseUrl` | string | Base URL for the tenant's AI Gateway token group.                  |
| `tokenGroupId`   | string | Telnyx AI Gateway token group ID.                                  |
| `tokenKeyId`     | string | Telnyx AI Gateway token key ID (used for inference auth).          |

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Tenant ledger provisioned successfully.          |
| 400  | Invalid `tenantId` or `monthlyBudget` value.     |
| 500  | Internal error (token group/key creation failed).|

---

## `GET /spend`

Returns the current month-to-date spend view for a tenant, including by-model breakdown, guardrail counts, alert history, and read-only status.

### Query Parameters

| Parameter  | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `tenantId` | string | yes      | The tenant identifier whose ledger to query.     |

### Example Request

```bash
curl -X GET "https://<your-worker-url>/spend?tenantId=acme-corp"
```

### Response Schema

**200 OK**

```json
{
  "tenantId": "acme-corp",
  "monthToDate": 412.50,
  "budget": 500.00,
  "pct": 82,
  "byModel": {
    "gpt-4o-mini": {
      "spend": 280.00,
      "inputTokens": 1500000,
      "outputTokens": 500000
    },
    "gpt-4o": {
      "spend": 132.50,
      "inputTokens": 300000,
      "outputTokens": 100000
    }
  },
  "guardrails": {
    "blocked": 3,
    "flagged": 7
  },
  "alerts": [
    {
      "level": "80",
      "at": "2025-07-15T14:30:00.000Z"
    }
  ],
  "readOnly": false
}
```

| Field           | Type     | Description                                                                 |
|-----------------|----------|-----------------------------------------------------------------------------|
| `tenantId`      | string   | The queried tenant ID.                                                      |
| `monthToDate`   | number   | Total spend in USD for the current billing period.                          |
| `budget`        | number   | The tenant's monthly budget in USD.                                         |
| `pct`           | number   | Percentage of budget consumed (0–100).                                      |
| `byModel`       | object   | Per-model spend and token usage. Keys are model names.                      |
| `byModel.*.spend`       | number | Spend in USD for this model.                                              |
| `byModel.*.inputTokens` | number | Input tokens consumed for this model.                                     |
| `byModel.*.outputTokens`| number | Output tokens consumed for this model.                                    |
| `guardrails.blocked`    | number | Count of requests blocked by secret-detection guardrails.                 |
| `guardrails.flagged`    | number | Count of requests flagged by DLP (financial) guardrails.                  |
| `alerts`        | array    | List of fired alerts, ordered by most recent first.                        |
| `alerts[].level`| string   | Alert threshold level (`"80"` or `"100"`).                                 |
| `alerts[].at`   | string   | ISO 8601 timestamp when the alert fired.                                   |
| `readOnly`      | boolean  | `true` if budget has reached 100% — gateway denies further requests.       |

### Status Codes

| Code | Description                                              |
|------|----------------------------------------------------------|
| 200  | Spend view returned successfully.                        |
| 400  | Missing or invalid `tenantId` query parameter.           |
| 404  | No ledger found for the given `tenantId`.                |
| 500  | Internal error (gateway API or database failure).        |

---

## `GET /health`

Health check endpoint for the Edge Worker.

### Example Request

```bash
curl -X GET https://<your-worker-url>/health
```

### Response Schema

**200 OK**

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description               |
|------|---------------------------|
| 200  | Worker is healthy.        |

---

## Internal RPC Methods (Actor-Level)

These methods are defined on the `SpendLedger` actor class and are invoked via the `LEDGERS` actor namespace. They are **not** directly accessible as HTTP endpoints.

### `provision(tenantId, monthlyBudget)`

- **Description**: Creates a Telnyx AI Gateway token group with `max_budget`, `budget_duration: "30d"`, and a guardrails policy (secrets block + DLP financial flag). Creates a primary token key. Initializes SQL schema and schedules the hourly rollup.
- **Parameters**:
  - `tenantId` (string): Unique tenant identifier.
  - `monthlyBudget` (number): Monthly budget in USD.
- **Returns**: `{ gatewayBaseUrl: string, tokenGroupId: string, tokenKeyId: string }`
- **Idempotent**: If the ledger is already provisioned, returns existing values without re-creating resources.

### `spendView(tenantId)`

- **Description**: Fetches the current spend summary from the AI Gateway `usage/summary` endpoint, queries the SQL `alerts` table for alert history, and computes the read-only flag based on budget percentage.
- **Parameters**:
  - `tenantId` (string): The tenant identifier.
- **Returns**: `SpendView` object (see response schema above).

### `rollup()`

- **Description**: Scheduled task (hourly via `this.schedule()`). Fetches `usage/summary` from the AI Gateway, upserts per-day rows into the `spend_days` SQL table, evaluates budget thresholds, and fires admin SMS alerts at 80% and 100% (alert-once via durable state flags `alerted80` / `alerted100`).
- **Parameters**: None.
- **Returns**: `void`

---

## Environment Variables

| Variable              | Required | Description                                              |
|-----------------------|----------|----------------------------------------------------------|
| `TELNYX_API_KEY`      | yes      | Telnyx API key (from `SECRETS` binding).                 |
| `DEMO_MODE`           | no       | Set to `"false"` to send real SMS. Defaults to demo.     |
| `ADMIN_SMS_FROM`      | yes      | Telnyx phone number to send SMS from.                    |
| `ADMIN_SMS_TO`        | yes      | Admin phone number to receive budget alerts.             |
| `DASHBOARD_ORIGIN`    | yes      | Origin of the tenant dashboard (for reference).          |
| `ROLLUP_CRON`         | no       | Cron expression for rollup schedule. Default: `"0 * * * *"`. |
| `WARN_PCT`            | no       | Warning threshold percentage. Default: `"80"`.           |
| `HARD_PCT`            | no       | Hard limit threshold percentage. Default: `"100"`.       |
| `SPEND_LOOKBACK_DAYS` | no       | Days of spend history to fetch. Default: `"31"`.         |

---

## SQL Schema

The following tables are created automatically by `initSchema()` on first use:

### `spend_days`

| Column         | Type    | Constraints               | Description                              |
|----------------|---------|---------------------------|------------------------------------------|
| `tenant`       | TEXT    | NOT NULL                  | Tenant identifier.                       |
| `day`          | TEXT    | NOT NULL                  | ISO date string (YYYY-MM-DD).            |
| `spend`        | REAL    | DEFAULT 0                 | Total spend for the day in USD.          |
| `input_tokens` | INTEGER | DEFAULT 0                 | Input tokens consumed that day.          |
| `output_tokens`| INTEGER | DEFAULT 0                 | Output tokens consumed that day.         |
| `blocked`      | INTEGER | DEFAULT 0                 | Guardrail-blocked requests that day.     |
| `flagged`      | INTEGER | DEFAULT 0                 | Guardrail-flagged requests that day.     |
| **PK**         |         | `(tenant, day)`           | Primary key — enables idempotent upserts.|

### `alerts`

| Column  | Type  | Constraints               | Description                              |
|---------|-------|---------------------------|------------------------------------------|
| `tenant`| TEXT  | NOT NULL                  | Tenant identifier.                       |
| `level` | TEXT  | NOT NULL                  | Alert level (`"80"` or `"100"`).         |
| `at`    | TEXT  | NOT NULL                  | ISO 8601 timestamp of alert.             |
| **PK**  |       | `(tenant, level, at)`     | Primary key — prevents duplicate alerts. |

### `guardrail_events`

| Column  | Type    | Constraints               | Description                              |
|---------|---------|---------------------------|------------------------------------------|
| `tenant`| TEXT    | NOT NULL                  | Tenant identifier.                       |
| `day`   | TEXT    | NOT NULL                  | ISO date string (YYYY-MM-DD).            |
| `blocked`| INTEGER| DEFAULT 0                 | Blocked guardrail events that day.       |
| `flagged`| INTEGER| DEFAULT 0                 | Flagged guardrail events that day.       |
| **PK**  |         | `(tenant, day)`           | Primary key.                             |
