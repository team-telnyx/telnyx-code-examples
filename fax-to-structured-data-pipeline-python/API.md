# API Reference — Fax-to-Structured-Data Pipeline

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/fax` | Receives Telnyx webhook events. |
| `POST` | `/extract` | Extract data. |
| `GET` | `/faxes` | List faxes. |
| `GET` | `/extracted` | List extracted. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/fax`

Receives Telnyx webhook events.

---

## `POST /extract`

Extract data.

### Request

```json
{
  "text": "Hello from the API",
  "type": "type-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | no | Text content |
| `type` | `string` | no | Type |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /faxes`

List all faxes.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /extracted`

List all extracted.

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
  "faxes": "...",
  "extracted": "..."
}
```

---

## Status Values

Records use these status values: `ok`, `queued`, `received`

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
