# API Reference — Interview Screen & Scheduler

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/candidates/screen` | Initiate screen. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/candidates` | List candidates. |
| `POST` | `/candidates/<int:idx>/advance` | Advance candidate. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /candidates/screen`

Initiate screen.

### Request

```json
{
  "name": "Jane Smith",
  "phone": "+12125559999",
  "position": "position-value",
  "source": "source-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `position` | `string` | no | Position |
| `source` | `string` | no | Traffic or lead source |

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

## `GET /candidates`

List all candidates.

### Response `200`

```json
{"candidates": candidates}
```

---

## `POST /candidates/<int:idx>/advance`

Advance candidate.

### Request

```json
{
  "time": "14:00"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `time` | `string` | no | Time (HH:MM format) |

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
  "candidates": "...",
  "passed": "..."
}
```

---

## Status Values

Records use these status values: `call_failed`, `interview_scheduled`, `not_advanced`, `ok`, `passed`, `screening`

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
