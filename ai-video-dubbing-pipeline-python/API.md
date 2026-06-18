# API Reference — AI Video Dubbing Pipeline

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/dub` | Start dubbing. |
| `GET` | `/dub/<job_id>` | Get job. |
| `GET` | `/dub/<job_id>/transcript` | Get transcript. |
| `GET` | `/languages` | List languages. |
| `GET` | `/jobs` | List jobs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /dub`

Start dubbing.

### Response `200`

```json
{"error": "Upload an audio file as "audio""}
```

---

## `GET /dub/<job_id>`

Get a specific job by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /dub/<job_id>/transcript`

Get a specific transcript by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /languages`

List all languages.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /jobs`

List all jobs.

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

Records use these status values: `complete`, `failed`, `ok`, `synthesizing`, `transcribing`, `translating`

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
