# API Reference — AI Conference Moderator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/meetings/create` | Create a new meeting. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/meetings/<mid>/advance` | Advance agenda. |
| `POST` | `/meetings/<mid>/mute/<call_id>` | Mute participant. |
| `GET` | `/meetings` | List meetings. |
| `GET` | `/meetings/<mid>` | Get meeting. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /meetings/create`

Create a new meeting.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | `string` | no | Topic |
| `agenda` | `array` | no | Agenda |
| `time_limit` | `string` | no | Time limit |
| `per_speaker_seconds` | `string` | no | Per speaker seconds |
| `participants` | `array` | no | List of participant phone numbers |
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

## `POST /meetings/<mid>/advance`

Advance agenda.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /meetings/<mid>/mute/<call_id>`

Mute participant.

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

## `GET /meetings/<mid>`

Get a specific meeting by ID.

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

Records use these status values: `active`, `completed`, `dialing`, `gathered`, `hangup`, `joined`, `left`, `muted`, `no_meeting`, `ok`, `pending`, `spoke`, `wrapping_up`

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
