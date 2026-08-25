# API Reference — SQL Migration Agent

This document describes the HTTP API exposed by the SQL Migration Agent. All endpoints return JSON.

**Base URL:** `http://localhost:5000` (configurable via the `PORT` environment variable)

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/migrations` | Create and queue a new migration |
| GET | `/migrations` | List all migrations |
| GET | `/migrations/{migration_id}` | Get migration status |
| DELETE | `/migrations/{migration_id}` | Cancel a queued migration |
| GET | `/schema/{db_name}` | Get current schema version |
| POST | `/webhooks/telnyx` | Receive Telnyx webhooks (e.g., SMS delivery status) |

---

## GET /health

Health check endpoint. Returns service status and current timestamp.

### Response — 200 OK

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000000+00:00"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Service is healthy |

---

## POST /migrations

Create and queue a new migration. This endpoint uses the `this.queue()` pattern for multi-instance rollout.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `migration_id` | string | Yes | Migration identifier. Use `"auto"` to generate a unique ID. Must match a script available in CloudFS (e.g., `migration_001`). |
| `db_name` | string | No | Target database name. Defaults to `"default"`. |
| `notify_phone` | string | No | Phone number (E.164 format) to receive SMS notifications about migration status. |

### Example Request

```bash
curl -X POST http://localhost:5000/migrations \
  -H "Content-Type: application/json" \
  -d '{
    "migration_id": "migration_001",
    "db_name": "users_db",
    "notify_phone": "+15551234567"
  }'
```

### Response — 202 Accepted

```json
{
  "migration_id": "migration_001",
  "status": "queued"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 202 | Migration queued successfully |
| 400 | Request body missing or `migration_id` not provided |
| 409 | Migration with the same ID already exists |

---

## GET /migrations

List all migrations and their current state.

### Example Request

```bash
curl http://localhost:5000/migrations
```

### Response — 200 OK

```json
{
  "migrations": [
    {
      "id": "migration_001",
      "db_name": "users_db",
      "status": "completed",
      "current_step": 3,
      "total_steps": 3,
      "created_at": "2026-01-15T10:30:00.000000+00:00",
      "notify_phone": "+15551234567",
      "schema_version": 1
    }
  ]
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Migrations returned successfully |

---

## GET /migrations/{migration_id}

Get the status of a specific migration.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `migration_id` | string | Yes | The migration identifier. |

### Example Request

```bash
curl http://localhost:5000/migrations/migration_001
```

### Response — 200 OK

```json
{
  "id": "migration_001",
  "db_name": "users_db",
  "status": "completed",
  "current_step": 3,
  "total_steps": 3,
  "created_at": "2026-01-15T10:30:00.000000+00:00",
  "notify_phone": "+15551234567",
  "schema_version": 1
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Migration found |
| 404 | Migration not found |

---

## DELETE /migrations/{migration_id}

Cancel a queued migration. Only migrations in `queued` status can be cancelled.

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `migration_id` | string | Yes | The migration identifier. |

### Example Request

```bash
curl -X DELETE http://localhost:5000/migrations/migration_001
```

### Response — 200 OK

```json
{
  "status": "cancelled"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Migration cancelled successfully |
| 400 | Migration cannot be cancelled (not in `queued` state) |
| 404 | Migration not found |

---

## GET /schema/{db_name}

Get the current schema version for a database.

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `db_name` | string | Yes | Database name. |

### Example Request

```bash
curl http://localhost:5000/schema/users_db
```

### Response — 200 OK

```json
{
  "db_name": "users_db",
  "schema_version": 1
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Schema version returned successfully |

---

## POST /webhooks/telnyx

Handle Telnyx webhooks (e.g., SMS delivery status). The request signature is verified using the Telnyx Ed25519 public key.

### Request Body

The request body is the raw Telnyx webhook payload. The Telnyx SDK verifies the signature and unwraps the event.

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "message.sent",
      "payload": {
        "id": "message_id_123",
        "status": "sent"
      }
    }
  }'
```

### Response — 200 OK

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Webhook processed successfully |
| 400 | Invalid signature or malformed webhook payload |

---

## Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Request succeeded |
| 202 | Request accepted (migration queued) |
| 400 | Bad request (missing/invalid parameters) |
| 404 | Resource not found |
| 409 | Conflict (resource already exists) |
| 500 | Internal server error |
