# API Reference — SMS Delivery Receipts

All endpoints accept and return JSON. The base URL in local development is `http://localhost:5000`.

---

## `POST /sms/send`

Send an SMS via Telnyx and record it for delivery tracking.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from Telnyx!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |
| `message` | `string` | **yes** | Message text to send |

### Response `200`

```json
{
  "message_id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID; use it to query status later |
| `status` | `string` | Always `queued` at send time |
| `from` | `string` | Sender number (`TELNYX_PHONE_NUMBER`) |
| `to` | `string` | Destination number |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

---

## `POST /webhooks/message`

Telnyx delivery-status callback. Called by Telnyx, not by your client. The raw body is verified against the `telnyx-signature-ed25519` and `telnyx-timestamp` headers before any parsing; verification failure returns `401`.

Only `message.finalized` events mutate state. Any other `event_type` is acknowledged and ignored.

### Request (sent by Telnyx)

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
      "to": [
        {
          "phone_number": "+12125551234",
          "status": "delivered",
          "error_code": null,
          "error_message": null
        }
      ]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event name; only `message.finalized` is processed |
| `data.payload.id` | `string` | Telnyx message ID, matched against the stored record |
| `data.payload.to[0].status` | `string` | Carrier delivery status (`delivered`, `failed`, …) |
| `data.payload.to[0].error_code` | `string \| null` | Carrier error code, when failed |
| `data.payload.to[0].error_message` | `string \| null` | Human-readable error, when failed |

### Responses

| Status | Body | When |
|--------|------|------|
| `200` | `{"status": "processed"}` | Receipt stored and message updated |
| `200` | `{"status": "already_processed"}` | Duplicate `message_id` (idempotent) |
| `200` | `{"status": "ignored"}` | `event_type` is not `message.finalized` |
| `400` | `{"error": "..."}` | Missing payload, message ID, or `to` array |
| `401` | `{"error": "invalid signature"}` | Signature/timestamp verification failed |

---

## `GET /messages/{message_id}`

Fetch one tracked message and its delivery receipt.

### Path parameters

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID returned by `POST /sms/send` |

### Response `200`

```json
{
  "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
  "from": "+15551234567",
  "to": "+12125551234",
  "text": "Hello from Telnyx!",
  "status": "delivered",
  "direction": "outbound",
  "created_at": "2026-06-18 22:40:00",
  "updated_at": "2026-06-18 22:40:03",
  "delivery_receipt": {
    "status": "delivered",
    "error_code": null,
    "error_message": null,
    "received_at": "2026-06-18 22:40:03"
  }
}
```

`delivery_receipt` is omitted until a `message.finalized` webhook has been processed for the message.

### Try it

```bash
curl http://localhost:5000/messages/40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44
```

---

## `GET /messages`

List tracked messages, newest first.

### Query parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | no | Filter by stored status (e.g. `queued`, `delivered`, `failed`) |

### Response `200`

```json
[
  {
    "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
    "from": "+15551234567",
    "to": "+12125551234",
    "status": "delivered",
    "direction": "outbound",
    "created_at": "2026-06-18 22:40:00"
  }
]
```

### Try it

```bash
curl "http://localhost:5000/messages?status=delivered"
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

Internal failures are logged server-side and return a generic message — exception details are never included in the response body.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key (`/sms/send`) or invalid webhook signature (`/webhooks/message`) |
| `404` | Message not found |
| `429` | Telnyx rate limit exceeded |
| `500` | Server error |
| `503` | Network error connecting to Telnyx |
