# API Reference — Production-ready Flask application for call recording via Telnyx Voice API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/initiate` | Initiate call endpoint. |
| `POST` | `/calls/<call_control_id>/recording/start` | Start recording endpoint. |
| `POST` | `/calls/<call_control_id>/recording/stop` | Stop recording endpoint. |
| `POST` | `/calls/<call_control_id>/hangup` | Hangup endpoint. |
| `POST` | `/webhooks/call-events` | Receives Telnyx webhook events. |
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

## `POST /calls/<call_control_id>/recording/start`

Start recording endpoint.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /calls/<call_control_id>/recording/stop`

Stop recording endpoint.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /calls/<call_control_id>/hangup`

Hangup endpoint.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/call-events`

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

Records use these status values: `answered`, `hangup`, `hangup_requested`, `initiated`, `received`, `recording`, `recording_stopped`

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
