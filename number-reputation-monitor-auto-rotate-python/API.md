# API Reference — Number Reputation Monitor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/scan` | Scan numbers. |
| `GET` | `/health-report` | Health check and service status. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /scan`

Scan numbers.

### Response `200`

```json
{"scanned": "...", "results": results}
```

---

## `GET /health-report`

Health check and service status.

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
