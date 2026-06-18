# API Reference — Fax to AI Document Processor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/fax` | Receives Telnyx webhook events. |
| `GET` | `/faxes` | List faxes. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/fax`

Receives Telnyx webhook events.

---

## `GET /faxes`

List all faxes.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "processed": "..."
}
```

---

## Status Values

Records use these status values: `ignored`, `ok`, `processed`

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
