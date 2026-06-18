# API Reference — AI Audiobook Narrator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/books/narrate` | Narrate book. |
| `GET` | `/books/<book_id>` | Get book. |
| `GET` | `/books` | List books. |
| `GET` | `/voices` | List voices. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /books/narrate`

Narrate book.

### Request

```json
{
  "title": "title-value",
  "text": "Hello from the API",
  "voice": "voice-value",
  "author": "author-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
| `text` | `string` | no | Text content |
| `voice` | `string` | no | TTS voice identifier |
| `author` | `string` | no | Author |

### Response `200`

```json
{"error": "Provide "text" to narrate"}
```

---

## `GET /books/<book_id>`

Get a specific book by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /books`

List all books.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /voices`

List all voices.

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

Records use these status values: `chunking`, `complete`, `failed`, `narrating`, `ok`

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
