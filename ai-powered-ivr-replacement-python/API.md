# API Reference — AI-Powered IVR Replacement

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/assistant` | Receives Telnyx webhook events. |
| `POST` | `/setup` | Setup assistant. |
| `GET` | `/analytics` | Get analytics. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/assistant`

Receives Telnyx webhook events.

---

## `POST /setup`

Setup assistant.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /analytics`

Get a specific analytics by ID.

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

Records use these status values: `created`, `event_received`, `insights_recorded`, `ok`, `tracked`

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
