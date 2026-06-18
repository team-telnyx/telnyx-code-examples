# API Reference — Prescription Refill Line

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/refills` | List refills. |
| `POST` | `/refills/<int:idx>/approve` | Approve refill. |
| `POST` | `/refills/<int:idx>/deny` | Deny refill. |
| `GET` | `/health` | Health check and service status. |

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

## `GET /refills`

List all refills.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /refills/<int:idx>/approve`

Approve refill.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pickup_time` | `string` | no | Pickup time |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /refills/<int:idx>/deny`

Deny refill.

### Request

```json
{
  "reason": "reason-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | `string` | no | Reason |

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
  "pending": "..."
}
```

---

## Status Values

Records use these status values: `approved`, `denied`, `ok`, `pending_pharmacist`

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
