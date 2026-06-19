# API Reference — Shortcode SMS

All endpoints accept and return JSON. The server runs on `http://localhost:5000` by default.

---

## `POST /sms/send`

Send an SMS from your Telnyx shortcode.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from your Telnyx shortcode!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format |
| `message` | `string` | **yes** | Message body (1–1600 characters) |

### Response `200`

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "123456",
  "to": "+12125551234",
  "segments": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID |
| `status` | `string` | Delivery status of the first recipient |
| `from` | `string` | Shortcode the message was sent from |
| `to` | `string` | Destination number |
| `segments` | `integer` | Number of SMS segments |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from your Telnyx shortcode!"}'
```

---

## `POST /webhooks/sms`

Receives inbound and delivery webhooks from Telnyx. **The Ed25519 signature is verified before the body is parsed** using `TELNYX_PUBLIC_KEY`; a missing or invalid signature returns `401`. This route is called by Telnyx, not by your application.

### Request (sent by Telnyx)

`event_type` is read from `data.event_type`; the message fields are read from `data.payload`.

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "msg-inbound-abc123",
      "from": { "phone_number": "+12125551234" },
      "to": [{ "phone_number": "123456" }],
      "text": "HELP",
      "direction": "inbound",
      "received_at": "2026-06-18T12:00:00Z"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | `message.received` or `message.finalized` |
| `data.payload.id` | `string` | Telnyx message ID |
| `data.payload.from.phone_number` | `string` | Sender number (inbound) |
| `data.payload.to[].phone_number` | `string` | Recipient (your shortcode) |
| `data.payload.to[].status` | `string` | Delivery status (on `message.finalized`) |
| `data.payload.text` | `string` | Message body |
| `data.payload.direction` | `string` | `inbound` or `outbound` |
| `data.payload.received_at` | `string` | ISO 8601 timestamp |

### Response `200`

```json
{ "status": "received" }
```

`status` is `received` for `message.received`, `processed` for `message.finalized`, and `acknowledged` for any other event type.

---

## `GET /messages/received`

Return all inbound messages captured in memory since startup.

### Response `200`

```json
[
  {
    "id": "msg-inbound-abc123",
    "from": "+12125551234",
    "to": "123456",
    "text": "HELP",
    "received_at": "2026-06-18T12:00:00Z",
    "direction": "inbound"
  }
]
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "healthy", "timestamp": "2026-06-18T12:00:00.000000" }
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Exception details are logged server-side and never returned in the response body.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key (`/sms/send`) or invalid webhook signature (`/webhooks/sms`) |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Network error connecting to Telnyx |
