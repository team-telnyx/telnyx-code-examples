# API Reference — Patient Appointment Engine

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/appointments` | List appointments. |
| `POST` | `/appointments/<int:idx>/approve` | Approve appointment. |
| `POST` | `/appointments/<int:idx>/reject` | Reject appointment. |
| `POST` | `/copay/create` | Create a new copay. |
| `GET` | `/slots` | Get slots. |
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

## `GET /appointments`

List all appointments.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /appointments/<int:idx>/approve`

Approve appointment.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /appointments/<int:idx>/reject`

Reject appointment.

### Request

```json
{
  "reason": "reason-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | `string` | no | Reason |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /copay/create`

Create a new copay.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | no | Provider |
| `amount_cents` | `string` | no | Amount cents |
| `amount_cents` | `string` | no | Amount cents |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /slots`

Get a specific slots by ID.

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
  "appointments": "...",
  "pending": "..."
}
```

---

## Status Values

Records use these status values: `confirmed`, `ok`, `pending_review`, `rejected`

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
