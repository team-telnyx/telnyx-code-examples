# API Reference — Podcast Highlight Clipper

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clip` | Clip highlights. |
| `GET` | `/clip/<job_id>` | Get job. |
| `POST` | `/distribution` | Add to distribution. |
| `GET` | `/jobs` | List jobs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /clip`

Clip highlights.

### Response `200`

```json
{"error": "Upload audio as "audio""}
```

---

## `GET /clip/<job_id>`

Get a specific job by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /distribution`

Add to distribution.

### Request

```json
{
  "phone": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |

### Response `200`

```json
{
  "total": "..."
}
```

---

## `GET /jobs`

List all jobs.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `analyzing`, `complete`, `failed`, `generating_teasers`, `ok`, `transcribing`

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
