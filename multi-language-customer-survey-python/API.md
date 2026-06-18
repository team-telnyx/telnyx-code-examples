# API Reference — Multi-Language Customer Survey

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/survey/start` | Start survey. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/survey/results` | Get results. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /survey/start`

Start survey.

### Request

```json
{
  "contacts": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contacts` | `array` | no | Contacts |

### Response `200`

```json
{
  "queued": "..."
}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /survey/results`

Get a specific results by ID.

### Response `200`

```json
{"results": results, "total": "..."}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "completed": "...",
  "queued": "..."
}
```

---

## Status Values

Records use these status values: `asking`, `completed`, `listening`, `ok`, `processing`

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
