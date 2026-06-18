# API Reference — Deepfake Voice Detector

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/webhooks/media` | Receives Telnyx webhook events. |
| `POST` | `/calls/<call_id>/analyze` | Force analyze. |
| `GET` | `/calls` | List calls. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.initiated` | Call setup started |
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.streaming.started` | Event processed |
| `call.streaming.stopped` | Event processed |
| `call.hangup` | Call ended — cleans up session state |

---

## `POST /webhooks/media`

Receives Telnyx webhook events.

---

## `POST /calls/<call_id>/analyze`

Force analyze.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /calls`

List all calls.

### Response `200`

```json
{
        "total": "...",
        "flagged": "...",
        "calls": "..." or 0, reverse=true)
    }
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

Records use these status values: `analyzed`, `cleared`, `completed`, `deepfake_detected`, `ok`, `recording`

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
