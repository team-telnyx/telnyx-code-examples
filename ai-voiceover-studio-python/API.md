# API Reference — AI Voice-Over Studio

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/projects/create` | Create a new project. |
| `POST` | `/projects/<project_id>/retake` | Retake. |
| `GET` | `/projects/<project_id>` | Get project. |
| `GET` | `/projects` | List projects. |
| `GET` | `/voices` | List voices. |
| `GET` | `/styles` | List styles. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /projects/create`

Create a new project.

### Request

```json
{
  "script": "script-value",
  "title": "title-value",
  "voice": "voice-value",
  "style": "style-value",
  "takes": "takes-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `script` | `string` | no | Script |
| `title` | `string` | no | Title |
| `voice` | `string` | no | TTS voice identifier |
| `style` | `string` | no | Style |
| `takes` | `string` | no | Takes |

### Response `200`

```json
{"error": "Provide "script" text"}
```

---

## `POST /projects/<project_id>/retake`

Retake.

### Request

```json
{
  "voice": "voice-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voice` | `string` | no | TTS voice identifier |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /projects/<project_id>`

Get a specific project by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /projects`

List all projects.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /voices`

List all voices.

### Response `200`

```json
{"voices": {k: v["desc"] for k, v in VOICES."..."}
```

---

## `GET /styles`

List all styles.

### Response `200`

```json
{"styles": STYLES}
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

Records use these status values: `complete`, `directing`, `failed`, `ok`, `rendering`

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
