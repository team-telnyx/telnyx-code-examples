# API Reference — AI Compliance Quiz Phone

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/completions` | List completions. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /completions`

List all completions.

### Response `200`

```json
{"completions": completions[-50:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{"status": "ok", "total": "...", "passed": passed}
```

---

## Status Values

Records use these status values: `answering`, `asking`, `ended`, `grading`, `greeting`, `ok`

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
