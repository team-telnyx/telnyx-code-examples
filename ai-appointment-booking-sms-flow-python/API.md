# API Reference — AI Appointment Booking SMS Flow

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/bookings` | List bookings. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /bookings`

List all bookings.

### Response `200`

```json
{"bookings": bookings}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "bookings": "...",
  "available": "..."
}
```

---

## Status Values

Records use these status values: `booked`, `ignored`, `no_slots`, `ok`, `processing`, `showing_slots`

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
