# API Reference — Accounting Firm Tax Season Line

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/reminders/send` | Send reminders. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/clients` | List clients. |
| `POST` | `/clients/<int:idx>/doc-received` | Doc received. |
| `GET` | `/readiness` | Readiness dashboard. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /reminders/send`

Send reminders.

### Response `200`

```json
{ "status": "ok", "data": { } }
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

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /clients`

List all clients.

### Response `200`

```json
{"clients": clients}
```

---

## `POST /clients/<int:idx>/doc-received`

Doc received.

### Request

```json
{
  "document": "document-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document` | `string` | **yes** | Document |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /readiness`

Readiness dashboard.

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
  "clients": "..."
}
```

---

## Status Values

Records use these status values: `docs_pending`, `ok`, `ready`

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
