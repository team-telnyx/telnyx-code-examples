# API Reference — AI Live Call Participant

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conferences/create` | Create a new conference. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/webhooks/media` | Receives Telnyx webhook events. |
| `GET` | `/conferences` | List conferences. |
| `GET` | `/conferences/<name>/transcript` | Get transcript. |
| `POST` | `/conferences/<name>/ask` | Ask ai. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /conferences/create`

Create a new conference.

### Request

```json
{
  "name": "Jane Smith",
  "participants": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |
| `participants` | `array` | no | List of participant phone numbers |

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
| `call.initiated` | Call setup started |
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |
| `call.hangup` | Call ended — cleans up session state |

---

## `POST /webhooks/media`

Receives Telnyx webhook events.

---

## `GET /conferences`

List all conferences.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /conferences/<name>/transcript`

Get a specific transcript by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /conferences/<name>/ask`

Ask ai.

### Request

```json
{
  "question": "question-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | no | Question |

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

Records use these status values: `answered`, `answering`, `dialing`, `hangup`, `joined`, `left`, `listening`, `ok`, `processed`, `received`

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
