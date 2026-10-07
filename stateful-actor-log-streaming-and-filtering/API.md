# API Reference

This document describes the HTTP endpoints exposed by the Stateful Actor Log Streaming & Filtering sample. The API simulates the Telnyx Edge Stateful Actor lifecycle and the `telnyx-edge actors logs` observability commands over HTTP, backed by a real SQLite database.

## Base URL

```
http://localhost:8080
```

---

## POST /actors/{actor_type}/invoke

Invoke a method on a Stateful Actor instance. This endpoint simulates deploying and calling a Stateful Actor method (currently only `increment` is supported). Each invocation persists an invocation record and a runtime log entry.

### Path Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `actor_type` | string | Yes | The actor type name (e.g., `Counter`). |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | No | The actor method to invoke. Must be `increment`. Defaults to `increment`. |
| `instance_id` | string | No | The actor instance ID. If omitted, a new UUID is generated. |
| `payload` | object | No | Arbitrary payload passed to the actor method. |

### Example Request

```bash
curl -X POST http://localhost:8080/actors/Counter/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "method": "increment",
    "instance_id": "inst-abc123",
    "payload": {}
  }'
```

### Response Schema

**Status: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `result` | object | The actor method return value. Contains `count` (integer) and `instance_id` (string). |
| `instance_id` | string | The instance ID that handled the invocation. |
| `duration_ms` | integer | Invocation duration in milliseconds. |

```json
{
  "result": {
    "count": 3,
    "instance_id": "inst-abc123"
  },
  "instance_id": "inst-abc123",
  "duration_ms": 5
}
```

**Status: 400 Bad Request**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message describing the invalid request. |

```json
{
  "error": "Method 'foo' not supported"
}
```

**Status: 500 Internal Server Error**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Generic error message. |

```json
{
  "error": "Invocation failed"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Invocation succeeded. |
| 400 | Invalid method name or malformed JSON body. |
| 500 | Actor invocation raised an exception. |

---

## GET /actors/{actor_type}/logs

Query historical logs for a given actor type. This endpoint mirrors the `telnyx-edge actors logs <ActorType> --type <type>` CLI command. Supports filtering by log type and instance ID.

### Path Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `actor_type` | string | Yes | The actor type name (e.g., `Counter`). |

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | string | No | Log type to query: `invocations` or `runtime`. Defaults to `invocations`. |
| `instance` | string | No | Filter logs to a specific actor instance ID. |
| `limit` | integer | No | Maximum number of log records to return. Defaults to `100`. |

### Example Request

```bash
curl "http://localhost:8080/actors/Counter/logs?type=invocations&instance=inst-abc123&limit=50"
```

### Response Schema

**Status: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `actor_type` | string | The actor type queried. |
| `log_type` | string | The log type queried (`invocations` or `runtime`). |
| `count` | integer | Number of log records returned. |
| `logs` | array | Array of log record objects. |

#### Invocation Log Record

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique record ID (UUID). |
| `actor_type` | string | Actor type name. |
| `instance_id` | string | Instance ID that handled the invocation. |
| `method_name` | string | Method invoked (e.g., `increment`). |
| `outcome` | string | `success` or `error`. |
| `duration_ms` | integer | Invocation duration in milliseconds. |
| `timestamp` | string | ISO 8601 UTC timestamp. |
| `payload` | string | JSON-encoded request payload. |

#### Runtime Log Record

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique record ID (UUID). |
| `actor_type` | string | Actor type name. |
| `instance_id` | string | Instance ID that produced the log. |
| `method_name` | string | Method that produced the log (e.g., `increment`). |
| `message` | string | The runtime log message (console.log equivalent). |
| `timestamp` | string | ISO 8601 UTC timestamp. |

```json
{
  "actor_type": "Counter",
  "log_type": "invocations",
  "count": 2,
  "logs": [
    {
      "id": "a1b2c3d4-...",
      "actor_type": "Counter",
      "instance_id": "inst-abc123",
      "method_name": "increment",
      "outcome": "success",
      "duration_ms": 5,
      "timestamp": "2025-01-15T10:30:00.123456+00:00",
      "payload": "{}"
    }
  ]
}
```

**Status: 400 Bad Request**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message for invalid log type. |

```json
{
  "error": "Invalid log type. Use 'invocations' or 'runtime'."
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Logs retrieved successfully. |
| 400 | Invalid `type` query parameter. |

---

## GET /actors/{actor_type}/logs/stream

Live stream logs for a given actor type using Server-Sent Events (SSE). This endpoint mirrors the `telnyx-edge actors logs <ActorType> --tail` CLI command. New log records are pushed to the client as they are written to the database.

### Path Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `actor_type` | string | Yes | The actor type name (e.g., `Counter`). |

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | string | No | Log type to stream: `invocations` or `runtime`. Defaults to `runtime`. |
| `instance` | string | No | Filter streamed logs to a specific actor instance ID. |

### Example Request

```bash
curl -N "http://localhost:8080/actors/Counter/logs/stream?type=runtime"
```

### Response Schema

**Status: 200 OK** — `Content-Type: text/event-stream`

The response is an SSE stream. Each event is delivered as:

```
data: { ...json log record... }

```

Each `data` payload is a JSON object matching the log record schema described in [GET /actors/{actor_type}/logs](#get-actorsactortypelogs). The stream remains open indefinitely until the client disconnects (Ctrl-C equivalent).

### Status Codes

| Code | Description |
|------|-------------|
| 200 | SSE stream established. |

---

## GET /actors/{actor_type}/instances

List all instances of a given actor type, including their current state.

### Path Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `actor_type` | string | Yes | The actor type name (e.g., `Counter`). |

### Example Request

```bash
curl "http://localhost:8080/actors/Counter/instances"
```

### Response Schema

**Status: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `actor_type` | string | The actor type queried. |
| `instances` | array | Array of instance objects. |

#### Instance Object

| Field | Type | Description |
|-------|------|-------------|
| `instance_id` | string | The instance ID. |
| `state` | string | JSON-encoded actor state (e.g., `{"count": 5}`). |
| `created_at` | string | ISO 8601 UTC timestamp of instance creation. |

```json
{
  "actor_type": "Counter",
  "instances": [
    {
      "instance_id": "inst-abc123",
      "state": "{\"count\": 5}",
      "created_at": "2025-01-15T10:25:00.000000+00:00"
    }
  ]
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Instances retrieved successfully. |

---

## GET /actors

List all deployed actor types (i.e., actor types that have at least one instance in the database).

### Example Request

```bash
curl "http://localhost:8080/actors"
```

### Response Schema

**Status: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `actors` | array of strings | List of actor type names. |

```json
{
  "actors": ["Counter"]
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Actor types retrieved successfully. |

---

## GET /health

Health check endpoint. Returns service status and whether demo mode is active.

### Example Request

```bash
curl "http://localhost:8080/health"
```

### Response Schema

**Status: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `ok`. |
| `demo_mode` | boolean | Whether the service is running in demo mode. |

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Service is healthy. |
