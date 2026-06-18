# API Reference — Production-ready Flask application for sending bulk SMS via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sms/bulk/send` | Send bulk sms endpoint. |
| `GET` | `/sms/bulk/status` | Bulk sms status. |

---

## `POST /sms/bulk/send`

Send bulk sms endpoint.

### Request

```json
{
  "recipients": [
    "+12125559999"
  ],
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipients` | `array` | no | List of phone numbers (E.164) |
| `message` | `string` | **yes** | Message content to send |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sms/bulk/status`

Bulk sms status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

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
