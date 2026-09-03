# API Reference — Multi-Tenant Voice Platform

All endpoints are exposed on the Telnyx Edge runtime via a single default export handler. The platform routes inbound Call Control webhooks by tenant ID, enforces per-tenant rate limits via KV, loads per-tenant configuration from a SQL database, and maintains isolated per-tenant call state via a `StatefulActor`.

---

## Table of Contents

1. [POST `/webhooks/call-control`](#post-webhookscall-control)
2. [GET `/tenants/:tenantId`](#get-tenantstenantid)
3. [GET `/tenants/:tenantId/rate-limit`](#get-tenantstenantidrate-limit)
4. [GET `/tenants/:tenantId/state`](#get-tenantstenantidstate)

---

## POST `/webhooks/call-control`

**Description:**  
Inbound Call Control webhook handler. Receives events from Telnyx, extracts the tenant ID from the `X-Tenant-ID` header, performs a KV-based rate-limit check, loads tenant config from SQL, delegates call-state management to a per-tenant `StatefulActor`, and forwards the event to the tenant's configured `webhook_url`.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `headers` | object | Yes | HTTP headers including `X-Tenant-ID`, `Telnyx-Signature-Ed25519`, `Telnyx-Timestamp` |
| `body` | object | Yes | Telnyx Call Control webhook payload |
| `body.event` | string | Yes | Event type (e.g., `call.initiated`, `call.answered`, `call.completed`) |
| `body.data` | object | Yes | Event data envelope |
| `body.data.call_control_id` | string | Yes | Unique identifier for the call leg |
| `body.data.call_id` | string | Yes | Telnyx call ID |
| `body.data.from` | string | Yes | Caller phone number (E.164) |
| `body.data.to` | string | Yes | Callee phone number (E.164) |
| `body.data.state` | string | No | Custom state field passed through Call Control commands |

### Example Request (curl)

```bash
curl -X POST https://<edge-app>.telnyx.run/webhooks/call-control \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: tenant_abc123" \
  -H "Telnyx-Signature-Ed25519: 4f8e2a..." \
  -H "Telnyx-Timestamp: 1718000000" \
  -d '{
    "event": "call.initiated",
    "data": {
      "call_control_id": "CC-abc123",
      "call_id": "CA-def456",
      "from": "+15551234567",
      "to": "+15559876543",
      "state": "tenant_abc123"
    }
  }'
```

### Response

**Status: 200 OK**

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"forwarded"` |
| `tenant_id` | string | The tenant ID extracted from the header |
| `call_control_id` | string | The call control ID from the payload |
| `actor_state` | string | Current state of the per-tenant `StatefulActor` |

```json
{
  "status": "forwarded",
  "tenant_id": "tenant_abc123",
  "call_control_id": "CC-abc123",
  "actor_state": "ringing"
}
```

### Status Codes

| Code | Meaning | Description |
|---|---|---|
| `200` | OK | Webhook received, rate limit passed, forwarded to tenant |
| `400` | Bad Request | Missing `X-Tenant-ID` header or malformed payload |
| `401` | Unauthorized | Telnyx Ed25519 signature verification failed |
| `429` | Too Many Requests | Tenant has exceeded their per-tenant rate limit |
| `404` | Not Found | Tenant ID not found in SQL `tenants` table |
| `500` | Internal Server Error | Unexpected error during processing |

---

## GET `/tenants/:tenantId`

**Description:**  
Retrieves the full tenant configuration record from the SQL `tenants` table. Used internally by the webhook handler and available as a diagnostic endpoint.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `tenantId` | string | Yes (path) | The unique tenant identifier |

### Example Request (curl)

```bash
curl -X GET https://<edge-app>.telnyx.run/tenants/tenant_abc123
```

### Response

**Status: 200 OK**

| Field | Type | Description |
|---|---|---|
| `id` | string | Tenant ID (primary key) |
| `name` | string | Human-readable tenant name |
| `api_key` | string | Masked API key (last 4 chars only) |
| `settings` | object | Arbitrary tenant settings JSON |
| `webhook_url` | string | URL to forward Call Control events to |
| `rate_limit` | number | Max requests per minute allowed |
| `max_calls` | number | Maximum concurrent calls allowed |

```json
{
  "id": "tenant_abc123",
  "name": "Acme Corp",
  "api_key": "••••••••••key_abc123",
  "settings": {
    "timezone": "America/New_York",
    "language": "en-US"
  },
  "webhook_url": "https://acme.example.com/telnyx/webhook",
  "rate_limit": 100,
  "max_calls": 10
}
```

### Status Codes

| Code | Meaning | Description |
|---|---|---|
| `200` | OK | Tenant configuration returned |
| `404` | Not Found | Tenant ID not found in SQL database |
| `500` | Internal Server Error | Database query failed |

---

## GET `/tenants/:tenantId/rate-limit`

**Description:**  
Reads the current rate-limit counter for the specified tenant from the KV store. The key format is `tenant:${tenantId}:rate`.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `tenantId` | string | Yes (path) | The unique tenant identifier |

### Example Request (curl)

```bash
curl -X GET https://<edge-app>.telnyx.run/tenants/tenant_abc123/rate-limit
```

### Response

**Status: 200 OK**

| Field | Type | Description |
|---|---|---|
| `tenant_id` | string | The tenant ID |
| `current_count` | number | Number of requests in the current window |
| `limit` | number | Maximum allowed requests per window |
| `remaining` | number | Remaining requests before rate limit is hit |
| `reset_in_seconds` | number | Seconds until the rate-limit window resets |

```json
{
  "tenant_id": "tenant_abc123",
  "current_count": 42,
  "limit": 100,
  "remaining": 58,
  "reset_in_seconds": 45
}
```

### Status Codes

| Code | Meaning | Description |
|---|---|---|
| `200` | OK | Rate-limit data returned |
| `404` | Not Found | Tenant ID not found in KV store |
| `500` | Internal Server Error | KV read failed |

---

## GET `/tenants/:tenantId/state`

**Description:**  
Retrieves the current call state for the specified tenant from the per-tenant `StatefulActor` instance. Each tenant gets its own actor namespace, ensuring complete isolation of call state.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `tenantId` | string | Yes (path) | The unique tenant identifier |

### Example Request (curl)

```bash
curl -X GET https://<edge-app>.telnyx.run/tenants/tenant_abc123/state
```

### Response

**Status: 200 OK**

| Field | Type | Description |
|---|---|---|
| `tenant_id` | string | The tenant ID |
| `actor_id` | string | The actor instance ID (same as tenant ID) |
| `active_calls` | array | List of active call control IDs |
| `total_calls` | number | Total calls handled by this tenant's actor |
| `last_event` | string | Timestamp of the last processed Call Control event |
| `current_state` | string | Aggregate state of the tenant's call activity |

```json
{
  "tenant_id": "tenant_abc123",
  "actor_id": "tenant_abc123",
  "active_calls": ["CC-abc123", "CC-xyz789"],
  "total_calls": 156,
  "last_event": "2024-06-10T14:30:00Z",
  "current_state": "in_call"
}
```

### Status Codes

| Code | Meaning | Description |
|---|---|---|
| `200` | OK | Actor state returned |
| `404` | Not Found | No actor instance exists for this tenant |
| `500` | Internal Server Error | Actor state retrieval failed |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELNYX_API_KEY` | Yes | Telnyx API key used for Call Control commands and SDK authentication |

> **Note:** The `TELNYX_API_KEY` is loaded from the environment at startup and never hardcoded. It is used by the Telnyx SDK (`@telnyx/edge-sdk`) for all API interactions.
