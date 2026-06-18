# API Reference — AI Standup Facilitator Phone

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/standups` | List standups. |
| `GET` | `/standups/summary` | Daily summary. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /standups`

List all standups.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /standups/summary`

Daily summary.

### Response `200`

```json
{
  "message": "No updates today"
}
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

Records use these status values: `answering`, `ended`, `greeting`, `listening`, `ok`, `responding`, `waiting`

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
