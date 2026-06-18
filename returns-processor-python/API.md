# API Reference — Returns Processor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/returns` | List returns. |
| `POST` | `/returns/<int:idx>/approve` | Manual approve. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /returns`

List all returns.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /returns/<int:idx>/approve`

Manual approve.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | `string` | no | Agent |
| `refund_amount` | `number` | no | Refund amount |
| `payment_intent` | `string` | no | Payment intent |

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
  "returns": "..."
}
```

---

## Status Values

Records use these status values: `auto_approved`, `escalated`, `evaluating`, `exchange_offered`, `manually_approved`, `ok`

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
