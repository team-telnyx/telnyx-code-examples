# API Reference — AI Podcast Call-In Show

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/queue` | Get queue. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /queue`

Get a specific queue by ID.

### Response `200`

```json
{"queue": [{"name": c["name"], "topic": c["topic"], "position": i+1}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "queue": "...",
  "active": "..."
}
```

---

## Status Values

Records use these status values: `answering`, `ended`, `greeting`, `listening`, `ok`, `processing`

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
