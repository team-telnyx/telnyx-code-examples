# API Reference — Call Analytics Dashboard API — pull CDRs and build usage analytics.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/analytics/calls` | Call analytics. |
| `GET` | `/analytics/numbers` | Number analytics. |
| `GET` | `/analytics/messaging` | Messaging analytics. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /analytics/calls`

Call analytics.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /analytics/numbers`

Number analytics.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /analytics/messaging`

Messaging analytics.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok"
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
