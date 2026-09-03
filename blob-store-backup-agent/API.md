# API Reference — BlobStore Backup Agent

The BlobStore Backup Agent is a **Telnyx Edge Agent** that runs on a 24-hour schedule. It reads blobs from BlobStore, uploads them to Cloud Storage, logs each backup to a SQL registry, verifies checksums, and sends an SMS notification via Telnyx when the backup cycle completes.

This document describes the **HTTP endpoints** exposed by the agent for operational control and status inspection.

---

## Table of Contents

1. [GET /health](#get-health)
2. [GET /backups](#get-backups)
3. [GET /backups/{id}](#get-backupsid)
4. [POST /backups/run](#post-backupsrun)
5. [GET /backups/stats](#get-backupsstats)

---

## GET /health

Returns the liveness status of the agent.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| _none_ | — | — | No request body. |

### Example Request

```bash
curl -X GET https://<agent-subdomain>.telnyx.net/health
```

### Response — `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"`. |
| `agent` | `string` | Agent identifier, e.g. `"blob-store-backup-agent"`. |
| `timestamp` | `string` (ISO 8601) | Current UTC timestamp. |

```json
{
  "status": "ok",
  "agent": "blob-store-backup-agent",
  "timestamp": "2025-01-15T12:00:00Z"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Agent is healthy and running. |
| `500` | Internal error — agent is unhealthy. |

---

## GET /backups

Lists all backup records from the SQL registry, ordered by most recent first.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | `integer` | No | Maximum number of records to return. Default: `50`. |
| `verified` | `boolean` | No | If `true`, only return verified backups. If `false`, only unverified. If omitted, return all. |

### Example Request

```bash
curl -X GET "https://<agent-subdomain>.telnyx.net/backups?limit=10&verified=true"
```

### Response — `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `backups` | `array[BackupRecord]` | Array of backup records. |
| `count` | `integer` | Number of records returned. |

#### BackupRecord

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | Unique backup record identifier. |
| `timestamp` | `string` (ISO 8601) | When the backup was created. |
| `size` | `integer` | Size of the backed-up blob in bytes. |
| `verified` | `boolean` | Whether the checksum verification passed. |
| `blob_name` | `string` | Name of the source blob in BlobStore. |
| `storage_path` | `string` | Destination path in Cloud Storage. |

```json
{
  "backups": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "timestamp": "2025-01-15T11:00:00Z",
      "size": 2048576,
      "verified": true,
      "blob_name": "customer_data_20250115.csv",
      "storage_path": "gs://backup-bucket/customer_data_20250115.csv"
    }
  ],
  "count": 1
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Backup records retrieved successfully. |
| `400` | Invalid query parameter (e.g. `limit` is not a positive integer). |
| `500` | Internal error reading from the SQL registry. |

---

## GET /backups/{id}

Retrieves a single backup record by its UUID.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (UUID) | Yes | Path parameter — the backup record UUID. |

### Example Request

```bash
curl -X GET https://<agent-subdomain>.telnyx.net/backups/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Response — `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | Unique backup record identifier. |
| `timestamp` | `string` (ISO 8601) | When the backup was created. |
| `size` | `integer` | Size of the backed-up blob in bytes. |
| `verified` | `boolean` | Whether the checksum verification passed. |
| `blob_name` | `string` | Name of the source blob in BlobStore. |
| `storage_path` | `string` | Destination path in Cloud Storage. |

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2025-01-15T11:00:00Z",
  "size": 2048576,
  "verified": true,
  "blob_name": "customer_data_20250115.csv",
  "storage_path": "gs://backup-bucket/customer_data_20250115.csv"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Backup record found and returned. |
| `404` | No backup record exists with the given `id`. |
| `500` | Internal error retrieving the record. |

---

## POST /backups/run

Triggers an immediate on-demand backup cycle (bypassing the 24-hour schedule). Useful for testing or manual recovery.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blob_name` | `string` | No | If provided, back up only this blob. If omitted, back up all blobs in BlobStore. |

### Example Request

```bash
curl -X POST https://<agent-subdomain>.telnyx.net/backups/run \
  -H "Content-Type: application/json" \
  -d '{"blob_name": "customer_data_20250115.csv"}'
```

### Response — `202 Accepted`

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | `string` (UUID) | Identifier for the triggered backup job. |
| `status` | `string` | Always `"started"`. |
| `message` | `string` | Human-readable confirmation. |

```json
{
  "job_id": "f00d1234-5678-9abc-def0-123456789abc",
  "status": "started",
  "message": "Backup cycle initiated. Check /backups for results."
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `202` | Backup job accepted and started. |
| `400` | Invalid request body (e.g. `blob_name` is not a string). |
| `404` | Specified `blob_name` does not exist in BlobStore. |
| `500` | Internal error initiating the backup cycle. |

---

## GET /backups/stats

Returns aggregate statistics about all backups in the SQL registry.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| _none_ | — | — | No request body. |

### Example Request

```bash
curl -X GET https://<agent-subdomain>.telnyx.net/backups/stats
```

### Response — `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `total_backups` | `integer` | Total number of backup records. |
| `verified_backups` | `integer` | Number of backups where `verified = true`. |
| `unverified_backups` | `integer` | Number of backups where `verified = false`. |
| `total_bytes` | `integer` | Sum of all backup sizes in bytes. |
| `last_backup_timestamp` | `string` (ISO 8601) | Timestamp of the most recent backup, or `null` if none exist. |

```json
{
  "total_backups": 142,
  "verified_backups": 140,
  "unverified_backups": 2,
  "total_bytes": 286720000,
  "last_backup_timestamp": "2025-01-15T11:00:00Z"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Statistics computed and returned. |
| `500` | Internal error computing statistics. |

---

## Error Response Format

All error responses use the following JSON shape:

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Short error category (e.g. `"not_found"`, `"bad_request"`, `"internal_error"`). |
| `message` | `string` | Human-readable description. Sensitive details are never exposed. |

```json
{
  "error": "not_found",
  "message": "No backup record found with the given id."
}
```

---

## Authentication

All endpoints are publicly accessible within the Telnyx Edge network. For production deployments, restrict access using Telnyx Edge's built-in [network policies](https://docs.telnyx.com) or place the agent behind an authenticated reverse proxy.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `GET /health` | 100 requests / minute |
| `GET /backups` | 60 requests / minute |
| `GET /backups/{id}` | 60 requests / minute |
| `POST /backups/run` | 5 requests / minute |
| `GET /backups/stats` | 60 requests / minute |

Exceeding a limit returns `429 Too Many Requests` with a `Retry-After` header.
