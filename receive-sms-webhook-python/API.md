# API Reference — Production-ready Flask webhook endpoint for receiving inbound SMS via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |

---

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## Status Values

Records use these status values: `error`, `ignored`, `received`

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
