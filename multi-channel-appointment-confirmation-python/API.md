# API Reference — Multi-Channel Appointment Confirmation

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/appointments` | Create a new appointment. |
| `POST` | `/confirm/<aid>` | Send confirmation. |
| `POST` | `/escalate/<aid>` | Escalate to voice. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/appointments/status` | Appointment status. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /appointments`

Create a new appointment.

### Request

```json
{
  "name": "Jane Smith",
  "phone": "+12125559999",
  "date": "2026-07-15",
  "time": "14:00",
  "provider": "provider-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `date` | `string` | **yes** | Date (YYYY-MM-DD format) |
| `time` | `string` | **yes** | Time (HH:MM format) |
| `provider` | `string` | no | Provider |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /confirm/<aid>`

Send confirmation.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /escalate/<aid>`

Escalate to voice.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### DTMF Options

| Key | Action |
|-----|--------|
| `1` | Confirmed |
| `2` | Reschedule Requested |

---

## `GET /appointments/status`

Appointment status.

### Response `200`

```json
{"appointments": "...", "summary": summary, "confirmations": "..."}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "appointments": "..."
}
```

---

## Status Values

Records use these status values: `confirmed`, `ended`, `greeting`, `handled`, `ignored`, `listening`, `ok`, `pending`, `reschedule_requested`, `sms_sent`, `voice_calling`

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
