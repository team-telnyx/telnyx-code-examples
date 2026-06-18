# API Reference — Video Room AI Meeting Moderator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rooms` | Create a new room. |
| `POST` | `/rooms/<room_id>/start` | Start meeting. |
| `GET` | `/rooms/<room_id>/status` | Meeting status. |
| `POST` | `/rooms/<room_id>/next` | Next topic. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /rooms`

Create a new room.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agenda` | `array` | no | Agenda |
| `duration_minutes` | `string` | no | Duration minutes |
| `name` | `string` | no | Display name or label |
| `max_participants` | `string` | no | Max participants |
| `id` | `string` | **yes** | Id |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /rooms/<room_id>/start`

Start meeting.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /rooms/<room_id>/status`

Meeting status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /rooms/<room_id>/next`

Next topic.

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
  "rooms": "..."
}
```

---

## Status Values

Records use these status values: `active`, `all_topics_completed`, `completed`, `no_active_topic`, `ok`, `pending`, `started`

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
