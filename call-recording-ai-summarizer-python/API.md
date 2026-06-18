# API Reference — Call Recording AI Summarizer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/summarize` | Summarize recording. |
| `GET` | `/recordings` | List recordings. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `POST /summarize`

Summarize recording.

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

## `GET /recordings`

List all recordings.

### Response `200`

```json
{"recordings": recordings[-50:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "recordings": "..."
}
```

---

## Status Values

Records use these status values: `ok`, `saved`

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
