# API Reference — SMS Conversation Threading

All endpoints accept and return JSON. The server runs on `http://localhost:5000` by default.

---

## `POST /conversations/<contact_number>/send`

Send an outbound SMS to a contact and append it to their conversation thread.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `contact_number` | `string` | **yes** | Destination phone number in E.164 format (e.g. `+12125551234`) |

### Request Body

```json
{
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | **yes** | Text body to send |

### Response `201`

```json
{
  "id": "string (uuid)",
  "conversation_id": "string (uuid)",
  "direction": "outbound",
  "from": "string (E.164)",
  "to": "string (E.164)",
  "body": "string",
  "status": "string",
  "created_at": "string (ISO 8601)"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/conversations/+12125551234/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from the API"}'
```

---

## `GET /conversations`

List all conversation threads, ordered by most recent activity.

### Response `200`

```json
[
  {
    "id": "string (uuid)",
    "contact_number": "string (E.164)",
    "message_count": "integer",
    "last_message_at": "string (ISO 8601)",
    "created_at": "string (ISO 8601)"
  }
]
```

### Try it

```bash
curl http://localhost:5000/conversations
```

---

## `GET /conversations/<conversation_id>`

Retrieve a single thread with all of its messages in chronological order.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `conversation_id` | `string` | **yes** | Conversation UUID returned by `GET /conversations` |

### Response `200`

```json
{
  "id": "string (uuid)",
  "contact_number": "string (E.164)",
  "message_count": "integer",
  "created_at": "string (ISO 8601)",
  "last_message_at": "string (ISO 8601)",
  "messages": [
    {
      "id": "string (uuid)",
      "direction": "string (inbound | outbound)",
      "from": "string (E.164)",
      "to": "string (E.164)",
      "body": "string",
      "status": "string",
      "created_at": "string (ISO 8601)"
    }
  ]
}
```

### Response `404`

```json
{ "error": "Conversation not found" }
```

### Try it

```bash
curl http://localhost:5000/conversations/<conversation_id>
```

---

## `POST /webhooks/sms`

Receives Telnyx inbound messaging webhook events. Called automatically by Telnyx — do not call directly. The request's Ed25519 signature is verified against `TELNYX_PUBLIC_KEY` before the body is parsed. Only `message.received` events are stored; other event types return `{"status": "ignored"}`.

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `telnyx-signature-ed25519` | `string` | **yes** | Ed25519 signature of the raw body |
| `telnyx-timestamp` | `string` | **yes** | Unix timestamp used for replay protection |

### Request Body (event)

```json
{
  "data": {
    "event_type": "message.received",
    "id": "string (uuid)",
    "occurred_at": "string (ISO 8601)",
    "payload": {
      "id": "string",
      "from": { "phone_number": "string (E.164)" },
      "to": [ { "phone_number": "string (E.164)" } ],
      "text": "string"
    },
    "record_type": "event"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event name; only `message.received` is processed |
| `data.payload.from.phone_number` | `string` | Sender (becomes the conversation key) |
| `data.payload.to[0].phone_number` | `string` | Recipient Telnyx number |
| `data.payload.text` | `string` | Message body |
| `data.payload.id` | `string` | Telnyx message ID |

### Response `200`

```json
{ "status": "stored" }
```

### Try it

```bash
curl -X POST http://localhost:5000/webhooks/sms
# Returns 401 invalid signature unless the request is a genuine signed Telnyx webhook.
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok" }
```

### Try it

```bash
curl http://localhost:5000/health
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Resource created (message sent and stored) |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key, or invalid webhook signature |
| `404` | Conversation not found |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Network error reaching Telnyx |

Exception details are never returned in responses; failures are logged server-side and surfaced as generic messages.
