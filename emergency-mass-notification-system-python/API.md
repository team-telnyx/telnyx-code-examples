# API Reference — Emergency Mass Notification System

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/notify` | Send notification. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/notifications` | List notifications. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /notify`

Send notification.

### Request

```json
{
  "message": "Hello from the API",
  "contacts": [],
  "severity": "severity-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | no | Message content to send |
| `contacts` | `array` | no | Contacts |
| `severity` | `string` | no | Severity |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /notifications`

List all notifications.

### Response `200`

```json
{ "status": "ok" }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "notifications": "..."
}
```

---

## Status Values

Records use these status values: `acknowledged`, `alerting`, `ended`, `no_match`, `ok`, `waiting_ack`

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
