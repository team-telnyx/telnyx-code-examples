# API Reference — WebRTC AI Interpreter for Live Calls

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/interpret` | Start interpreted call. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /interpret`

Start interpreted call.

### Request

```json
{
  "caller_a": {},
  "caller_b": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `caller_a` | `object` | no | Caller a |
| `caller_b` | `object` | no | Caller b |

### Response `200`

```json
{
  "status": "configured",
  "note": "AI interpreter bridges calls with real-time translation via transcription + TTS"
}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "active": "..."
}
```

---

## Status Values

Records use these status values: `answering`, `configured`, `ended`, `listening`, `ok`, `ready`, `translating`

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
