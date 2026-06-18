# API Reference — Restaurant Reservation & Waitlist

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/waitlist/add` | Add to waitlist. |
| `POST` | `/waitlist/<int:idx>/ready` | Table ready. |
| `GET` | `/reservations` | List reservations. |
| `GET` | `/waitlist` | List waitlist. |
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

## `POST /waitlist/add`

Add to waitlist.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `party_size` | `string` | no | Party size |
| `wait_minutes` | `string` | no | Wait minutes |

### Response `200`

```json
{"position": "...", "entry": entry}
```

---

## `POST /waitlist/<int:idx>/ready`

Table ready.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /reservations`

List all reservations.

### Response `200`

```json
{"reservations": reservations}
```

---

## `GET /waitlist`

List all waitlist.

### Response `200`

```json
{"waitlist": [w for w in waitlist if w["status"] == "waiting"]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "reservations": "...",
  "waitlist": "..."
}
```

---

## Status Values

Records use these status values: `confirmed`, `notified`, `ok`, `waiting`

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
