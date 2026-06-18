# API Reference — AI Sales Coach (Whisper)

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/start` | Start coaching. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/webhooks/media` | Receives Telnyx webhook events. |
| `GET` | `/sessions` | List sessions. |
| `GET` | `/sessions/<name>` | Get session. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /sessions/start`

Start coaching.

### Request

```json
{
  "customer": "customer-value",
  "rep": "rep-value",
  "context": "context-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `customer` | `string` | **yes** | Customer |
| `rep` | `string` | **yes** | Rep |
| `context` | `string` | no | Context |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |
| `call.hangup` | Call ended — cleans up session state |

---

## `POST /webhooks/media`

Receives Telnyx webhook events.

---

## `GET /sessions`

List all sessions.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sessions/<name>`

Get a specific session by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
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

Records use these status values: `answered`, `briefing_rep`, `dialing_customer`, `dialing_rep`, `ended`, `hangup`, `live`, `no_session`, `ok`, `processed`, `received`, `spoke`, `starting`

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
