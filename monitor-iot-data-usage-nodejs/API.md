# API Reference — Monitor IoT Data Usage

All application routes are read-only HTTP `GET` requests. Routes under `/api` are mounted from the Express router; `/health` is mounted at the root.

## `GET /api/sims`

List all SIM cards, each merged with the latest cached data usage.

### Request

No path parameters, query parameters, or body.

### Response `200`

Array of SIM objects.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIM card ID |
| `iccid` | `string` | SIM ICCID |
| `status` | `string` | SIM status (e.g. `active`) |
| `simCardGroupId` | `string` \| `null` | SIM card group ID |
| `dataUsage` | `object` \| `null` | Cached network usage payload, or `null` if not yet polled |
| `lastUpdated` | `string (ISO 8601)` \| `null` | Timestamp when usage was read from cache, or `null` |

```json
[
  {
    "id": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
    "iccid": "89310410106543789301",
    "status": "active",
    "simCardGroupId": "e8e4c2cb-7d0e-4b4c-9c8e-2f0b2a9d7c11",
    "dataUsage": { "usage_bytes": 524288000, "limit_bytes": 1073741824 },
    "lastUpdated": "2026-06-18T12:00:00.000Z"
  }
]
```

**Try it:**

```bash
curl http://localhost:5000/api/sims
```

---

## `GET /api/sims/:simCardId`

Retrieve live SIM details and network usage for one SIM card (fetched directly from Telnyx).

### Request

| Field | In | Type | Required | Description |
|-------|----|------|----------|-------------|
| `simCardId` | path | `string` | **yes** | Telnyx SIM card ID |

### Response `200`

| Field | Type | Description |
|-------|------|-------------|
| `simCardId` | `string` | Telnyx SIM card ID |
| `iccid` | `string` | SIM ICCID |
| `status` | `string` | SIM status |
| `simCardGroupId` | `string` \| `null` | SIM card group ID |
| `dataUsage` | `object` | Network usage payload from Telnyx (`usage_bytes`, `limit_bytes`, ...) |

```json
{
  "simCardId": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
  "iccid": "89310410106543789301",
  "status": "active",
  "simCardGroupId": "e8e4c2cb-7d0e-4b4c-9c8e-2f0b2a9d7c11",
  "dataUsage": { "usage_bytes": 524288000, "limit_bytes": 1073741824 }
}
```

**Try it:**

```bash
curl http://localhost:5000/api/sims/6b14e151-8493-4fa1-8664-1cc33d18b29d
```

---

## `GET /api/sims/:simCardId/usage-summary`

Return a computed, human-readable usage summary from cached data. Values in MB are strings (fixed to 2 decimals).

### Request

| Field | In | Type | Required | Description |
|-------|----|------|----------|-------------|
| `simCardId` | path | `string` | **yes** | Telnyx SIM card ID |

### Response `200`

| Field | Type | Description |
|-------|------|-------------|
| `simCardId` | `string` | Telnyx SIM card ID |
| `totalDataLimitMB` | `string` | `limit_bytes` converted to MB |
| `usedDataMB` | `string` | `usage_bytes` converted to MB |
| `remainingDataMB` | `string` | `(limit_bytes - usage_bytes)` in MB |
| `percentageUsed` | `string` | Used / limit as a percentage |
| `alert` | `string` | `"WARNING: Data usage exceeds 80%"` when over 80%, otherwise `"OK"` |

```json
{
  "simCardId": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
  "totalDataLimitMB": "1024.00",
  "usedDataMB": "500.00",
  "remainingDataMB": "524.00",
  "percentageUsed": "48.83",
  "alert": "OK"
}
```

**Try it:**

```bash
curl http://localhost:5000/api/sims/6b14e151-8493-4fa1-8664-1cc33d18b29d/usage-summary
```

---

## `GET /health`

Liveness check.

### Request

No parameters.

### Response `200`

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` |
| `timestamp` | `string (ISO 8601)` | Current server time |

```json
{ "status": "ok", "timestamp": "2026-06-18T12:00:00.000Z" }
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Telnyx API Endpoints Called

The server calls these Telnyx v2 endpoints (via the `telnyx` SDK and `axios`):

| Method | Path | Used by | Purpose |
|--------|------|---------|---------|
| `GET` | `/v2/sim_cards` | `listAllSimCards()` (SDK `client.simCards.list()`) | List all SIM cards |
| `GET` | `/v2/sim_cards/{id}` | `getSimDataUsage()` (SDK `client.simCards.retrieve()`) | Retrieve a SIM card |
| `GET` | `/v2/sim_cards/{id}/network_usage` | `getSimDataUsage()` (axios with Bearer auth) | Fetch network usage metrics |

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `401` | Invalid Telnyx API key (`Telnyx.AuthenticationError`) |
| `404` | SIM not found, or usage not yet cached |
| `429` | Telnyx rate limit exceeded (`Telnyx.RateLimitError`) |
| `503` | Network error reaching Telnyx (`Telnyx.APIConnectionError`) |
| `500` | Internal server error |

`Telnyx.APIError` is surfaced with the upstream `error.status` and message.
