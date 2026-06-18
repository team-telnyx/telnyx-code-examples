# API Reference — Multi-Party AI Training Call

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/training/start` | Start training. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/training/<sid>` | Get session detail. |
| `GET` | `/training` | List sessions view. |
| `GET` | `/scenarios` | List scenarios. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /training/start`

Start training.

### Request

```json
{
  "scenario": "scenario-value",
  "trainees": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scenario` | `string` | no | Scenario |
| `trainees` | `array` | no | Trainees |

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

## `GET /training/<sid>`

Get session detail.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /training`

List sessions view.

### Response `200`

```json
{"sessions": [{
        "id": s["id"], "scenario": s["scenario"]["name"],
        "status": s["status"], "trainees": "...",
        "scored": "...",
    }
```

---

## `GET /scenarios`

List all scenarios.

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

Records use these status values: `active`, `completed`, `dialing`, `hangup`, `joined`, `left`, `listening`, `no_session`, `ok`, `pending`, `processed`

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
