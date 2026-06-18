# API Reference — Bulk Number Validation & Cleaner

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/validate` | Validate numbers. |
| `GET` | `/validate/single/<number>` | Validate single. |
| `GET` | `/jobs` | List jobs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /validate`

Validate numbers.

### Request

```json
{
  "numbers": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numbers` | `array` | no | List of phone numbers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /validate/single/<number>`

Validate single.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /jobs`

List all jobs.

### Response `200`

```json
{"jobs": summaries}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "jobs": "..."
}
```

---

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
