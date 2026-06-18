# API Reference — Payment Reminder Escalation

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/invoices` | Add invoice. |
| `POST` | `/reminders/run` | Run reminders. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/invoices` | List invoices. |
| `POST` | `/invoices/<int:idx>/paid` | Mark paid. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /invoices`

Add invoice.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `company` | `string` | **yes** | Company |
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `amount` | `number` | no | Amount in dollars |
| `due_date` | `string` | **yes** | Due date |
| `payment_link` | `string` | no | Payment link |

### Response `200`

```json
{"invoice": inv}
```

---

## `POST /reminders/run`

Run reminders.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `days_overdue` | `string` | no | Days overdue |

### Response `200`

```json
{"results": results}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.answered` | Begins interaction (TTS greeting or gather) |

---

## `GET /invoices`

List all invoices.

### Response `200`

```json
{"invoices": invoices}
```

---

## `POST /invoices/<int:idx>/paid`

Mark paid.

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
  "unpaid": "..."
}
```

---

## Status Values

Records use these status values: `ok`, `paid`, `unpaid`

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
