# API Reference — Podcast Episode Repurposer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repurpose` | Repurpose episode. |
| `GET` | `/repurpose/<job_id>` | Get job. |
| `POST` | `/subscribers` | Add subscriber. |
| `GET` | `/subscribers` | List subscribers. |
| `GET` | `/jobs` | List jobs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /repurpose`

Repurpose episode.

### Response `200`

```json
{"error": "Upload episode audio as "audio""}
```

---

## `GET /repurpose/<job_id>`

Get a specific job by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /subscribers`

Add subscriber.

### Request

```json
{
  "phone": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |

### Response `200`

```json
{"error": "Provide "phone" in E.164 format"}
```

---

## `GET /subscribers`

List all subscribers.

### Response `200`

```json
{"subscribers": [s[-4:] for s in subscribers], "total": "..."}
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

Records use these status values: `complete`, `extracting`, `failed`, `generating_clips`, `ok`, `transcribing`

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
