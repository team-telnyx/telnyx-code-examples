# API Reference — Video Webinar Recording Manager

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webinars` | Create a new webinar. |
| `GET` | `/webinars/<room_id>/recordings` | Get recordings. |
| `POST` | `/recordings/<recording_id>/transcribe` | Transcribe recording. |
| `GET` | `/webinars` | List webinars. |
| `GET` | `/recordings` | List processed. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webinars`

Create a new webinar.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
| `max_participants` | `string` | no | Max participants |
| `title` | `string` | **yes** | Title |
| `host` | `string` | **yes** | Host |
| `scheduled` | `string` | **yes** | Scheduled |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /webinars/<room_id>/recordings`

Get a specific recordings by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /recordings/<recording_id>/transcribe`

Transcribe recording.

### Request

```json
{
  "transcript": "transcript-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript` | `string` | no | Transcript |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /webinars`

List all webinars.

### Response `200`

```json
{"webinars": "...")}
```

---

## `GET /recordings`

List all processed.

### Response `200`

```json
{"recordings": recordings[-20:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "webinars": "...",
  "recordings": "..."
}
```

---

## Status Values

Records use these status values: `ok`, `scheduled`

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
