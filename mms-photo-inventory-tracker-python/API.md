# API Reference — MMS Photo Inventory Tracker

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/inventory` | List inventory. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /inventory`

List all inventory.

### Response `200`

```json
{"items": items[-50:], "total": "..."}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "items": "..."
}
```

---

## Status Values

Records use these status values: `cataloged`, `ignored`, `listed`, `ok`

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
