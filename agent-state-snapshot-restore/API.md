# API Reference — Agent State Snapshot & Restore

This document describes the HTTP endpoints exposed by the `agent-state-snapshot-restore` sample. The application is a Telnyx Edge (TypeScript) project that demonstrates durable agent state management using the Agent SDK, BlobStore, and a SQL snapshot registry.

---

## Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/snapshot` | Create a snapshot of the agent's current state. |
| `GET` | `/snapshots` | List all stored snapshots for the agent. |
| `GET` | `/snapshot/:id` | Retrieve metadata for a specific snapshot. |
| `POST` | `/restore/:id` | Restore agent state from a previously stored snapshot. |
| `GET` | `/health` | Health check endpoint. |

---

## POST /snapshot

Creates a snapshot of the current agent state by calling `this.getState()`, serializing the result, storing it in BlobStore, and logging the snapshot metadata in the SQL registry.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | `string` | No | Human-readable description of the snapshot. |
| `agentId` | `string` | No | Identifier for the agent (defaults to `"default-agent"`). |

### Example Request

```bash
curl -X POST http://localhost:8787/snapshot \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Snapshot before maintenance window",
    "agentId": "default-agent"
  }'
```

### Response Schema

**Status Code: `200 OK`**

```json
{
  "id": "snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "blobKey": "snapshots/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
  "description": "Snapshot before maintenance window",
  "agentId": "default-agent",
  "stateSize": 1024
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique snapshot identifier. |
| `timestamp` | `string` (ISO 8601) | UTC timestamp of when the snapshot was created. |
| `blobKey` | `string` | Key under which the serialized state is stored in BlobStore. |
| `description` | `string` | Description provided in the request. |
| `agentId` | `string` | Agent identifier. |
| `stateSize` | `number` | Size in bytes of the serialized state blob. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Snapshot created successfully. |
| `400` | Invalid request body (missing or malformed fields). |
| `500` | Internal server error during snapshot creation. |

---

## GET /snapshots

Lists all snapshots stored in the SQL registry, ordered by most recent first.

### Query Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Filter snapshots by agent ID (defaults to `"default-agent"`). |

### Example Request

```bash
curl -X GET "http://localhost:8787/snapshots?agentId=default-agent"
```

### Response Schema

**Status Code: `200 OK`**

```json
{
  "snapshots": [
    {
      "id": "snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "blobKey": "snapshots/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
      "description": "Snapshot before maintenance window",
      "agentId": "default-agent",
      "stateSize": 1024
    },
    {
      "id": "snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
      "timestamp": "2024-01-15T09:15:00.000Z",
      "blobKey": "snapshots/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
      "description": "Initial state snapshot",
      "agentId": "default-agent",
      "stateSize": 512
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `snapshots` | `array<object>` | Array of snapshot metadata objects. See [POST /snapshot](#post-snapshot) response for field definitions. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Snapshots retrieved successfully. |
| `500` | Internal server error during retrieval. |

---

## GET /snapshot/:id

Retrieves metadata for a specific snapshot by its ID.

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The unique snapshot identifier. |

### Example Request

```bash
curl -X GET http://localhost:8787/snapshot/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y
```

### Response Schema

**Status Code: `200 OK`**

```json
{
  "id": "snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "blobKey": "snapshots/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
  "description": "Snapshot before maintenance window",
  "agentId": "default-agent",
  "stateSize": 1024
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique snapshot identifier. |
| `timestamp` | `string` (ISO 8601) | UTC timestamp of when the snapshot was created. |
| `blobKey` | `string` | Key under which the serialized state is stored in BlobStore. |
| `description` | `string` | Description provided at snapshot creation. |
| `agentId` | `string` | Agent identifier. |
| `stateSize` | `number` | Size in bytes of the serialized state blob. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Snapshot metadata retrieved successfully. |
| `404` | Snapshot with the given ID was not found. |
| `500` | Internal server error during retrieval. |

---

## POST /restore/:id

Restores agent state from a previously stored snapshot. The endpoint looks up the snapshot metadata in the SQL registry, retrieves the serialized state from BlobStore, and calls `this.replaceState()` on the agent to restore the state.

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The unique snapshot identifier to restore from. |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Identifier for the agent to restore state into (defaults to `"default-agent"`). |

### Example Request

```bash
curl -X POST http://localhost:8787/restore/snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "default-agent"
  }'
```

### Response Schema

**Status Code: `200 OK`**

```json
{
  "id": "snap_01H4Z8Q2VJ5K9M3N7P6R1T0Y",
  "restored": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "description": "Snapshot before maintenance window",
  "agentId": "default-agent",
  "stateSize": 1024
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The snapshot ID that was restored. |
| `restored` | `boolean` | Always `true` if the restore succeeded. |
| `timestamp` | `string` (ISO 8601) | UTC timestamp of the original snapshot. |
| `description` | `string` | Description of the restored snapshot. |
| `agentId` | `string` | Agent identifier. |
| `stateSize` | `number` | Size in bytes of the restored state blob. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | State restored successfully. |
| `404` | Snapshot with the given ID was not found. |
| `500` | Internal server error during restore (e.g., BlobStore retrieval failure, state deserialization error). |

---

## GET /health

Simple health check endpoint to verify the service is running.

### Example Request

```bash
curl -X GET http://localhost:8787/health
```

### Response Schema

**Status Code: `200 OK`**

```json
{
  "status": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` when the service is healthy. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Service is healthy. |

---

## Error Response Format

All error responses (4xx, 5xx) follow a consistent JSON structure:

```json
{
  "error": "A human-readable error message."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Generic error description. No internal details or stack traces are exposed. |

---

## Environment Variables

The application reads the following environment variables (see `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Telnyx API key used for SDK authentication. |
| `BLOBSTORE_ACCOUNT_ID` | Yes | Telnyx BlobStore account ID for snapshot storage. |
| `SQL_CONNECTION_STRING` | Yes | Connection string for the SQL snapshot registry database. |
| `PORT` | No | Port to listen on (default: `8787`). |
