# API Reference — Voice-Over Audition Generator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auditions/create` | Create a new audition. |
| `GET` | `/auditions/<audition_id>` | Get audition. |
| `GET` | `/auditions` | List auditions. |
| `GET` | `/voices` | List voices. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /auditions/create`

Create a new audition.

### Request

```json
{
  "script": "script-value",
  "project": "project-value",
  "context": "context-value",
  "notify": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `script` | `string` | no | Script |
| `project` | `string` | no | Project |
| `context` | `string` | no | Context |
| `notify` | `array` | no | Notify |

### Response `200`

```json
{"error": "Provide "script" text"}
```

---

## `GET /auditions/<audition_id>`

Get a specific audition by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /auditions`

List all auditions.

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

Records use these status values: `complete`, `ok`, `rendering`, `scoring`

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
