# API Reference — Two-Way SMS Chat

All endpoints accept and return `application/json`.

## `POST /sms/send`

Send a single outbound SMS via Telnyx.

### Request

```json
{
  "to": "+12125559999",
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |
| `message` | `string` | **yes** | Message text to send |

### Response `200`

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999",
  "direction": "outbound"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message UUID |
| `status` | `string` | Per-recipient delivery status (`queued`, `sent`, etc.) or `unknown` |
| `from` | `string` | Your Telnyx number |
| `to` | `string` | The destination number |
| `direction` | `string` | Always `outbound` |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hello from the API"}'
```

---

## `POST /webhooks/sms`

Receives Telnyx messaging events. Called by Telnyx, not by clients. The raw request body is verified against `TELNYX_PUBLIC_KEY` before any processing; requests without a valid signature are rejected with `401`.

### Request (from Telnyx)

```json
{
  "data": {
    "event_type": "message.received",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "from": { "phone_number": "+12125559999" },
      "to": [{ "phone_number": "+15551234567" }],
      "text": "Hi there",
      "received_at": "2026-06-18T12:00:00.000Z"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | One of `message.received`, `message.sent`, `message.finalized` |
| `data.payload` | `object` | Message payload; fields below are read from here |
| `data.payload.id` | `string` | Telnyx message UUID |
| `data.payload.from.phone_number` | `string` | Sender number (inbound) |
| `data.payload.to` | `array` | Recipient list; each has `phone_number` and `status` |
| `data.payload.text` | `string` | Message body (inbound) |
| `data.payload.received_at` | `string` | ISO 8601 timestamp (inbound) |

### Behavior by event type

| `event_type` | Action |
|--------------|--------|
| `message.received` | Logs the inbound message and sends an automatic reply, then returns `200` |
| `message.sent` | Logs the message id, returns `200` |
| `message.finalized` | Logs the final per-recipient status, returns `200` |
| anything else | Acknowledged with `200` |

### Response `200`

```json
{ "success": true, "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6" }
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "ok" }
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Exception details are never returned in the response body — they are logged server-side only.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields, or malformed webhook payload |
| `401` | Invalid API key (`/sms/send`) or invalid webhook signature (`/webhooks/sms`) |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Network error connecting to Telnyx |
