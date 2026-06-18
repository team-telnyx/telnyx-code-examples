# API Reference — Service Booking & Dispatch

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/bookings` | List bookings. |
| `POST` | `/bookings/<int:idx>/assign` | Assign tech. |
| `GET` | `/techs` | List techs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.initiated` | Call setup started |
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |
| `call.hangup` | Call ended — cleans up session state |

---

## `GET /bookings`

List all bookings.

### Response `200`

```json
{"bookings": bookings}
```

---

## `POST /bookings/<int:idx>/assign`

Assign tech.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tech_name` | `string` | no | Tech name |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /techs`

List all techs.

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
  "bookings": "..."
}
```

---

## Status Values

Records use these status values: `assigned`, `ok`, `pending_deposit`

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
