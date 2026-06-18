# API Reference — E-commerce Order Status Bot

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/exceptions/check` | Check exceptions. |
| `GET` | `/exceptions` | List exceptions. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

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

## `POST /exceptions/check`

Check exceptions.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tracking_number` | `string` | **yes** | Tracking number |
| `exception` | `string` | no | Exception |
| `customer_phone` | `string` | **yes** | Customer phone |
| `new_eta` | `string` | no | New eta |

### Response `200`

```json
{
  "status": "notified"
}
```

---

## `GET /exceptions`

List all exceptions.

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
  "exceptions": "..."
}
```

---

## Status Values

Records use these status values: `any`, `notified`, `ok`, `shipped`

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
