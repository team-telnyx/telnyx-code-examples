# API Reference — E-Learning Course Narrator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/courses/create` | Create a new course. |
| `GET` | `/courses/<course_id>` | Get course. |
| `GET` | `/courses` | List courses. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /courses/create`

Create a new course.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
| `content` | `string` | no | Content |
| `voice` | `string` | no | TTS voice identifier |
| `include_quizzes` | `boolean` | no | Include quizzes |

### Response `200`

```json
{"error": "Provide "content" text"}
```

---

## `GET /courses/<course_id>`

Get a specific course by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /courses`

List all courses.

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

Records use these status values: `complete`, `failed`, `narrating`, `ok`, `structuring`

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
