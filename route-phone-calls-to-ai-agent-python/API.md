# API Reference — Production-ready Flask webhook for handling inbound calls via Telnyx Voice API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |

---

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## Status Values

Records use these status values: `answered`, `call_answered`, `call_ended`, `event_received`, `hangup_initiated`, `message_finished`

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
