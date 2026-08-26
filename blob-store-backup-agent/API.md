# Blob Store Backup Agent — API Reference

This document describes the HTTP API exposed by the Blob Store Backup Agent. All endpoints return JSON responses.

## Base URL

When running locally, the service is available at:

```
http://localhost:5000
```

---

## Endpoints

### 1. Health Check

Returns the current health status of the service.

#### Request

```
GET /health
```

No request body or query parameters are required.

#### Response

**Status Code: `200 OK`**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.123456+00:00"
}
```

#### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Service is healthy |

---

### 2. Trigger Backup

Manually triggers a backup cycle. This performs the same operation as the scheduled backup: iterates over all blobs in the blob store, uploads them to Google Cloud Storage, verifies checksums, records entries in the SQLite registry, and sends an SMS notification with the results.

#### Request

```
POST /backup
```

**Request Body:** None required.

#### Response

**Status Code: `200 OK`**

```json
{
  "status": "success",
  "message": "Backup completed"
}
```

**Status Code: `500 Internal Server Error`**

```json
{
  "status": "error",
  "message": "Backup failed"
}
```

#### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Backup completed successfully |
| `500` | Backup failed due to an internal error |

---

### 3. List Backups

Returns a list of all recorded backups from the SQLite registry, ordered by creation date (most recent first).

#### Request

```
GET /backups
```

**Request Body:** None required.

#### Response

**Status Code: `200 OK`**

```json
{
  "backups": [
    {
      "id": 1,
      "blob_name": "example.txt",
      "backup_path": "backups/example.txt",
      "checksum": "a3f5c8d1e9b2f4a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "created_at": "2024-01-15T10:30:00.123456+00:00"
    },
    {
      "id": 2,
      "blob_name": "image.png",
      "backup_path": "backups/image.png",
      "checksum": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
      "created_at": "2024-01-14T09:15:00.654321+00:00"
    }
  ]
}
```

**Status Code: `500 Internal Server Error`**

```json
{
  "status": "error",
  "message": "Failed to list backups"
}
```

#### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Backups retrieved successfully |
| `500` | Failed to retrieve backups due to an internal error |

---

## Common Response Format

All error responses follow a consistent JSON structure:

```json
{
  "status": "error",
  "message": "Human-readable error message"
}
```

---

## Error Handling

The API follows these error handling conventions:

- **No exception details are leaked** in HTTP responses. All internal errors are logged via `app.logger.exception()` and a generic error message is returned to the client.
- **Malformed requests** (e.g., invalid JSON bodies) will result in a `400 Bad Request` response from Flask's default error handler.
- **Unknown routes** will result in a `404 Not Found` response from Flask's default error handler.

---

## Status Code Reference

| Status Code | Description |
|-------------|-------------|
| `200` | Request succeeded |
| `400` | Bad request (malformed JSON, missing required fields) |
| `404` | Endpoint not found |
| `500` | Internal server error |

---

## Notes

- The `/backup` endpoint is synchronous — it will block until the entire backup cycle completes (including all uploads, checksum verifications, and SMS notification).
- The `/backups` endpoint reads directly from the SQLite registry and does not query Cloud Storage.
- All timestamps are returned in ISO 8601 format with UTC timezone offset.
- The service does not implement authentication. In production, it is recommended to place this service behind an API gateway or reverse proxy that handles authentication and rate limiting.
