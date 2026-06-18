# API Reference — AI Podcast Producer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/episodes/start` | Start episode. |
| `POST` | `/episodes/<episode_id>/stop` | Stop episode. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/episodes` | List episodes. |
| `GET` | `/episodes/<episode_id>` | Get episode. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /episodes/start`

Start episode.

### Request

```json
{
  "title": "title-value",
  "hosts": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
| `hosts` | `array` | no | Hosts |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /episodes/<episode_id>/stop`

Stop episode.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /episodes`

List all episodes.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /episodes/<episode_id>`

Get a specific episode by ID.

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

Records use these status values: `complete`, `dialing`, `ok`, `processing`

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
