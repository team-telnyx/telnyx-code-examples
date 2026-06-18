# API Reference — Production-ready IVR system using Telnyx Voice API and Flask.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |
| `GET` | `/webhooks/call/status` | Receives Telnyx webhook events. |

---

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## `GET /webhooks/call/status`

Receives Telnyx webhook events.

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
