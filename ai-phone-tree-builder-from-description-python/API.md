# API Reference — AI Phone Tree Builder

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate` | Generate phone tree. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /generate`

Generate phone tree.

### Request

```json
{
  "description": "description-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | `string` | no | Description |

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
