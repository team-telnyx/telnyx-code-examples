# API Reference — SMS Emergency Check-In

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/monitor` | Add monitored. |
| `POST` | `/check-in/send` | Send check ins. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `POST` | `/check-in/escalate` | Escalate missed. |
| `GET` | `/status` | Get status. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /monitor`

Add monitored.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `name` | `string` | no | Display name or label |
| `emergency_contact` | `string` | no | Emergency contact |

### Response `200`

```json
{"status": "monitoring", "phone": phone}
```

---

## `POST /check-in/send`

Send check ins.

### Response `200`

```json
{"sent": results}
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `POST /check-in/escalate`

Escalate missed.

### Response `200`

```json
{"escalated": escalated}
```

---

## `GET /status`

Get a specific status by ID.

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
  "monitored": "..."
}
```

---

## Status Values

Records use these status values: `escalated`, `handled`, `ignored`, `monitoring`, `ok`, `sent`, `unknown`, `waiting`

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
