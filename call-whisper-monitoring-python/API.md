# API Reference — Production-ready Flask application for Whisper-based call prompts via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/initiate` | Initiate call endpoint. |
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |
| `GET` | `/calls/<call_control_id>/status` | Get call status. |

---

## `POST /calls/initiate`

Initiate call endpoint.

### Request

```json
{
  "to": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## `GET /calls/<call_control_id>/status`

Get call status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `acknowledged`, `answered`, `hangup`, `initiated`, `processed`, `speaking`

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
