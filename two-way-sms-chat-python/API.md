# API Reference — Two-Way SMS Chat

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /webhooks/sms`

Inbound webhook called by Telnyx when your number receives an SMS. The raw request body is verified against the Telnyx Ed25519 signature **before** it is parsed. Requests with a missing or invalid signature are rejected with `401`.

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `telnyx-signature-ed25519` | `string` | **yes** | Ed25519 signature of the raw body (set by Telnyx) |
| `telnyx-timestamp` | `string` | **yes** | Unix timestamp used for replay protection (set by Telnyx) |
| `Content-Type` | `string` | **yes** | `application/json` |

### Request body (Telnyx event)

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+12125551234" },
      "to": [ { "phone_number": "+15551234567" } ],
      "text": "hello"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event name. Only `message.received` is processed; others are acknowledged. |
| `data.payload.from.phone_number` | `string` | Sender number (E.164). |
| `data.payload.to[].phone_number` | `string` | Recipient (your Telnyx number, E.164). |
| `data.payload.text` | `string` | Message body. |

> Event fields are read from `data.payload`; `event_type` is read from `data`.

### Response `200`

```json
{
  "status": "processed",
  "inbound_message": "hello",
  "response_sent": "Hello! Welcome to Telnyx SMS. Type 'help' ...",
  "message_id": "msg-f5d7a7e0-1234-5678"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `processed` for a handled `message.received`, `acknowledged` for other event types. |
| `inbound_message` | `string` | The text received. |
| `response_sent` | `string` | The reply that was sent back. |
| `message_id` | `string` | ID of the outbound reply message. |

### Try it

```bash
curl -X POST http://localhost:5000/webhooks/sms \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <unix-ts>" \
  -d '{"data":{"event_type":"message.received","payload":{"from":{"phone_number":"+12125551234"},"to":[{"phone_number":"+15551234567"}],"text":"hello"}}}'
```

---

## `POST /sms/send`

Send a single outbound SMS.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from Telnyx!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164). |
| `message` | `string` | **yes** | Message content to send. |

### Response `200`

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234",
  "text": "Hello from Telnyx!"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID. |
| `status` | `string` | Initial delivery status (e.g. `queued`). |
| `from` | `string` | Sending number. |
| `to` | `string` | Destination number. |
| `text` | `string` | Message body sent. |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

---

## `GET /conversations`

List active in-memory conversations. Debugging aid only — state is lost on restart.

### Response `200`

```json
[
  {
    "phone_number": "+12125551234",
    "state": "greeted",
    "message_count": 2,
    "created_at": "2026-06-18T12:00:00"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `phone_number` | `string` | Sender the conversation belongs to. |
| `state` | `string` | Current conversation state (`new`, `greeted`, `informed`, `reset`, `ended`). |
| `message_count` | `integer` | Number of inbound messages processed. |
| `created_at` | `string` | ISO-8601 timestamp the conversation started. |

### Try it

```bash
curl http://localhost:5000/conversations
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

Error messages are generic; details are logged server-side and never returned in the response body.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid webhook signature (`/webhooks/sms`) or invalid API key (`/sms/send`) |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Upstream network error talking to Telnyx |
