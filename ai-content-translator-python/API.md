# API Reference — AI Content Translator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/translate` | Translate content. |
| `GET` | `/translate/<job_id>` | Get translation. |
| `GET` | `/languages` | List languages. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /translate`

Translate content.

### Response `200`

```json
{"error": "Upload audio file as "audio""}
```

---

## `GET /translate/<job_id>`

Get a specific translation by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /languages`

List all languages.

### Response `200`

```json
{"languages": {k: v["name"] for k, v in LANGUAGES."..."}
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

Records use these status values: `complete`, `failed`, `ok`, `partial`, `processing`

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
