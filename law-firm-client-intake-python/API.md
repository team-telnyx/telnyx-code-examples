# API Reference — Law Firm Client Intake

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/intakes` | List intakes. |
| `POST` | `/intakes/<int:idx>/accept` | Accept intake. |
| `POST` | `/intakes/<int:idx>/decline` | Decline intake. |
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

## `GET /intakes`

List all intakes.

### Response `200`

```json
{"intakes": intakes}
```

---

## `POST /intakes/<int:idx>/accept`

Accept intake.

### Request

```json
{
  "attorney": "attorney-value",
  "time": "14:00"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `attorney` | `string` | no | Attorney |
| `time` | `string` | no | Time (HH:MM format) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /intakes/<int:idx>/decline`

Decline intake.

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

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "intakes": "...",
  "pending": "..."
}
```

---

## Status Values

Records use these status values: `accepted`, `declined`, `ok`, `pending_review`

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
