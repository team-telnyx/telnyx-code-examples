# API Reference — Production-ready Flask application for call forwarding via Telnyx Voice API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |
| `GET` | `/calls/status/<call_control_id>` | Get call status. |
| `POST` | `/calls/hangup/<call_control_id>` | Hangup call endpoint. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## `GET /calls/status/<call_control_id>`

Get call status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /calls/hangup/<call_control_id>`

Hangup call endpoint.

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
  "status": "healthy"
}
```

---

## Status Values

Records use these status values: `answered`, `call_answered`, `call_ended`, `call_forwarded`, `event_ignored`, `hangup_initiated`, `healthy`, `transfer_initiated`

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
