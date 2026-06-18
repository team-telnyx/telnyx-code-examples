# API Reference — Maintenance Request Dispatch

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/work-orders` | List work orders. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /work-orders`

List work orders.

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
  "status": "ok",
  "total": "...",
  "pending": "..."
}
```

---

## Status Values

Records use these status values: `approved`, `denied`, `dispatched`, `new`, `ok`, `pending_approval`

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
