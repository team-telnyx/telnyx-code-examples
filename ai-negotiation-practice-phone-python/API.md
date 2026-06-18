# API Reference — AI Negotiation Practice Phone

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/sessions` | List sessions. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /sessions`

List all sessions.

### Response `200`

```json
{"sessions": sessions[-20:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "sessions": "..."
}
```

---

## Status Values

Records use these status values: `answering`, `ended`, `greeting`, `listening`, `negotiating`, `ok`

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
