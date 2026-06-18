# API Reference — AI Meeting Action Tracker

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/meetings/create` | Create a new meeting. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/meetings/<mid>` | Get meeting. |
| `GET` | `/meetings` | List meetings. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /meetings/create`

Create a new meeting.

### Request

```json
{
  "title": "title-value",
  "participants": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
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
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |
| `call.hangup` | Call ended — cleans up session state |

---

## `GET /meetings/<mid>`

Get a specific meeting by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /meetings`

List all meetings.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{"status": "ok", "active": active, "total": "..."}
```

---

## Status Values

Records use these status values: `active`, `completed`, `dialing`, `joined`, `left`, `listening`, `no_meeting`, `ok`, `pending`, `processed`

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
