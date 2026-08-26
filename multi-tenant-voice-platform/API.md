# API Reference

This document describes the HTTP API exposed by the `multi-tenant-voice-platform` sample. All endpoints return JSON.

## Base URL

All endpoints are relative to your server's base URL. When running locally, this is `http://localhost:5000`.

## Authentication

Most endpoints require a tenant identifier passed via the `X-Tenant-ID` header. This header is used to route requests to the correct tenant configuration, rate limit bucket, and call state store.

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-Tenant-ID` | string | Yes (for tenant-scoped endpoints) | The tenant identifier (e.g., `tenant_a`). |

---

## Health Check

### `GET /health`

Returns the health status of the service.

**Response Schema**

| Status Code | Body |
|-------------|------|
| `200` | `{"status": "ok", "timestamp": "<ISO-8601 UTC>"}` |

**Example Request:**

```bash
curl http://localhost:5000/health
```

**Example Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000000+00:00"
}
```

---

## Tenant Management

### `GET /api/tenants`

Lists all configured tenants. This is an admin endpoint and does not require the `X-Tenant-ID` header.

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"tenants": [{"id": "<tenant_id>", "name": "<tenant_name>", "rate_limit_per_minute": <int>}]}` |

**Example Request:**

```bash
curl http://localhost:5000/api/tenants
```

**Example Response:**

```json
{
  "tenants": [
    {
      "id": "tenant_a",
      "name": "Tenant A",
      "rate_limit_per_minute": 10
    },
    {
      "id": "tenant_b",
      "name": "Tenant B",
      "rate_limit_per_minute": 5
    }
  ]
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Success. |

---

### `GET /api/tenants/<tenant_id>/config`

Returns the configuration for a specific tenant.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tenant_id` | string | Yes | The tenant identifier. |

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"tenant_id": "<tenant_id>", "name": "<tenant_name>", "rate_limit_per_minute": <int>, "default_voice_number_id": "<voice_number_id>"}` |
| `404` | `{"error": "Tenant not found"}` |

**Example Request:**

```bash
curl http://localhost:5000/api/tenants/tenant_a/config
```

**Example Response:**

```json
{
  "tenant_id": "tenant_a",
  "name": "Tenant A",
  "rate_limit_per_minute": 10,
  "default_voice_number_id": ""
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Success. |
| `404` | The specified tenant does not exist. |

---

## Call Management

### `POST /api/tenants/<tenant_id>/calls`

Initiates a call for a specific tenant. This endpoint is rate-limited per tenant.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tenant_id` | string | Yes | The tenant identifier. |

**Headers:**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-Tenant-ID` | string | Yes | Must match the `tenant_id` in the path. |
| `Content-Type` | string | Yes | `application/json` |

**Request Body Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | Yes | The destination phone number in E.164 format (e.g., `+15551234567`). |
| `from` | string | No | The source phone number. Defaults to the tenant's `default_voice_number_id`. |

**Example Request:**

```bash
curl -X POST http://localhost:5000/api/tenants/tenant_a/calls \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: tenant_a" \
  -d '{
    "to": "+15551234567",
    "from": "+15559876543"
  }'
```

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `201` | `{"call_id": "<call_id>", "status": "initiated", "tenant_id": "<tenant_id>"}` |
| `400` | `{"error": "Missing X-Tenant-ID header"}` or `{"error": "Missing required field: to"}` |
| `404` | `{"error": "Tenant not found"}` |
| `429` | `{"error": "Rate limit exceeded"}` with `Retry-After` header |
| `502` | `{"error": "Failed to initiate call"}` |

**Example Response:**

```json
{
  "call_id": "call_1234567890",
  "status": "initiated",
  "tenant_id": "tenant_a"
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `201` | Call initiated successfully. |
| `400` | Missing `X-Tenant-ID` header or missing required `to` field. |
| `404` | Tenant not found. |
| `429` | Rate limit exceeded. The `Retry-After` header indicates seconds to wait. |
| `502` | Telnyx API call failed. |

---

### `GET /api/tenants/<tenant_id>/calls`

Lists all call state records for a specific tenant.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tenant_id` | string | Yes | The tenant identifier. |

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"tenant_id": "<tenant_id>", "calls": [<call_state_object>]}` |
| `404` | `{"error": "Tenant not found"}` |

Each `<call_state_object>` has the following shape:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Current call status (e.g., `initiated`, `hangup_requested`, or a Telnyx call status). |
| `to` | string | Destination number. |
| `from` | string | Source number. |
| `created_at` | string | ISO-8601 timestamp of call creation. |
| `last_event` | string | The last call leg ID received via webhook. |
| `last_event_type` | string | The last event type received via webhook. |
| `updated_at` | string | ISO-8601 timestamp of last update. |

**Example Request:**

```bash
curl -H "X-Tenant-ID: tenant_a" \
  http://localhost:5000/api/tenants/tenant_a/calls
```

**Example Response:**

```json
{
  "tenant_id": "tenant_a",
  "calls": [
    {
      "status": "initiated",
      "to": "+15551234567",
      "from": "+15559876543",
      "created_at": "2025-01-15T10:00:00.000000+00:00"
    }
  ]
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Success. |
| `404` | Tenant not found. |

---

### `GET /api/tenants/<tenant_id>/calls/<call_id>`

Returns the state for a specific call.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tenant_id` | string | Yes | The tenant identifier. |
| `call_id` | string | Yes | The call identifier. |

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"tenant_id": "<tenant_id>", "call_id": "<call_id>", "state": <call_state_object>}` |
| `404` | `{"error": "Tenant not found"}` or `{"error": "Call not found"}` |

**Example Request:**

```bash
curl -H "X-Tenant-ID: tenant_a" \
  http://localhost:5000/api/tenants/tenant_a/calls/call_1234567890
```

**Example Response:**

```json
{
  "tenant_id": "tenant_a",
  "call_id": "call_1234567890",
  "state": {
    "status": "initiated",
    "to": "+15551234567",
    "from": "+15559876543",
    "created_at": "2025-01-15T10:00:00.000000+00:00"
  }
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Success. |
| `404` | Tenant or call not found. |

---

### `POST /api/tenants/<tenant_id>/calls/<call_id>/hangup`

Hangs up a specific call. This endpoint is rate-limited per tenant.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tenant_id` | string | Yes | The tenant identifier. |
| `call_id` | string | Yes | The call identifier. |

**Headers:**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-Tenant-ID` | string | Yes | Must match the `tenant_id` in the path. |

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"status": "hangup_requested", "call_id": "<call_id>"}` |
| `400` | `{"error": "Missing X-Tenant-ID header"}` |
| `404` | `{"error": "Tenant not found"}` or `{"error": "Call not found"}` |
| `429` | `{"error": "Rate limit exceeded"}` with `Retry-After` header |
| `502` | `{"error": "Failed to hang up call"}` |

**Example Request:**

```bash
curl -X POST \
  -H "X-Tenant-ID: tenant_a" \
  http://localhost:5000/api/tenants/tenant_a/calls/call_1234567890/hangup
```

**Example Response:**

```json
{
  "status": "hangup_requested",
  "call_id": "call_1234567890"
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Hangup requested successfully. |
| `400` | Missing `X-Tenant-ID` header. |
| `404` | Tenant or call not found. |
| `429` | Rate limit exceeded. The `Retry-After` header indicates seconds to wait. |
| `502` | Telnyx API call failed. |

---

## Webhooks

### `POST /webhooks/inbound`

Receives inbound webhooks from Telnyx. This endpoint verifies the Ed25519 signature and updates the corresponding call state.

**Headers:**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Telnyx-Signature-Ed25519` | string | Yes | The Ed25519 signature of the request body. |
| `Telnyx-Timestamp` | string | Yes | The timestamp used to generate the signature. |

**Request Body:**

The raw request body must be the Telnyx webhook payload. The endpoint reads `data.payload` for call state updates.

**Response Schema:**

| Status Code | Type |
|-----------|------|
| `200` | `{"status": "ok"}` |
| `401` | `{"error": "Invalid signature"}` |

**Example Request:**

```bash
curl -X POST http://localhost:5000/webhooks/inbound \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "payload": {
        "call_control_id": "call_1234567890",
        "call_status": "in-progress",
        "call_leg_id": "leg_123"
      }
    }
  }'
```

**Example Response:**

```json
{
  "status": "ok"
}
```

**Status Codes:**

| Status Code | Description |
|-----------|-------------|
| `200` | Webhook processed successfully. |
| `401` | Signature verification failed. |

---

## Global Error Codes

| Status Code | Description |
|-----------|-------------|
| `400` | Bad request — missing required headers or fields. |
| `404` | Resource not found. |
| `429` | Rate limit exceeded. The `Retry-After` header indicates seconds to wait. |
| `500` | Internal server error. |
| `502` | Upstream Telnyx API call failed. |
