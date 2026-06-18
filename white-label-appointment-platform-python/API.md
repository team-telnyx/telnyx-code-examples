# API Reference — White-Label Appointment Platform

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tenants` | Create a new tenant. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/tenants` | List tenants. |
| `GET` | `/tenants/<tid>/appointments` | Tenant appointments. |
| `GET` | `/tenants/<tid>/stats` | Tenant stats. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /tenants`

Create a new tenant.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | no | Id |
| `business_name` | `string` | **yes** | Business name |
| `phone_number` | `string` | **yes** | Phone number |
| `greeting` | `string` | no | Greeting |
| `services` | `array` | no | Services |
| `hours` | `string` | no | Hours |
| `calendar_webhook` | `string` | no | Calendar webhook |
| `notification_phone` | `string` | no | Notification phone |

### Response `200`

```json
{"tenant": tenant}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.initiated` | Call setup started |
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |
| `call.hangup` | Call ended — cleans up session state |

---

## `GET /tenants`

List all tenants.

### Response `200`

```json
{"tenants": "...")}
```

---

## `GET /tenants/<tid>/appointments`

Tenant appointments.

### Response `200`

```json
{"appointments": appointments."..."}
```

---

## `GET /tenants/<tid>/stats`

Tenant stats.

### Response `200`

```json
{
  "total": "...",
  "confirmed": "..."
}
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

Records use these status values: `confirmed`, `no_tenant`, `ok`

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
