# API Reference — Production-ready Flask application for text-to-speech calls via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/initiate` | Initiate call endpoint. |
| `POST` | `/calls/<call_control_id>/speak` | Speak endpoint. |
| `POST` | `/calls/<call_control_id>/hangup` | Hangup endpoint. |
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |
| `GET` | `/calls/status` | Get calls status. |

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

## `POST /calls/<call_control_id>/speak`

Speak endpoint.

### Request

```json
{
  "text": "Hello from the API",
  "language": "language-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | **yes** | Text content |
| `language` | `string` | no | Language code (e.g., `en-US`) |

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

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## `GET /calls/status`

Get calls status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `answered`, `hangup_initiated`, `initiated`, `received`, `speak_ended`

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
