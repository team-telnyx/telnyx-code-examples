# API Reference — Toll-Free SMS

All endpoints return JSON. Base URL in local development: `http://localhost:5000`.

---

## `GET /health`

Liveness probe for monitoring.

### Response `200`

```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T12:00:00.000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"healthy"` when the process is up |
| `timestamp` | `string` | ISO-8601 UTC timestamp |

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## `POST /sms/send`

Send an SMS from the configured toll-free number.

### Request

```json
{
  "to": "+12125551234",
  "message": "Your verification code is 123456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `message` | `string` | **yes** | Message content (max 1600 characters) |

### Response `200`

```json
{
  "message_id": "40000000-0000-0000-0000-000000000000",
  "status": "queued",
  "from": "+18885551234",
  "to": "+12125551234",
  "segments": 1,
  "created_at": "2026-06-18T12:00:00.000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message UUID |
| `status` | `string` | Initial status, typically `queued` |
| `from` | `string` | Toll-free sending number |
| `to` | `string` | Destination number |
| `segments` | `integer` | Estimated SMS segment count (160 chars/segment) |
| `created_at` | `string` | ISO-8601 UTC creation timestamp |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Your verification code is 123456"}'
```

---

## `GET /sms/status/<message_id>`

Return the cached delivery record for a previously sent message.

### Path parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `message_id` | `string` | **yes** | The `message_id` returned by `POST /sms/send` |

### Response `200`

```json
{
  "id": "40000000-0000-0000-0000-000000000000",
  "from": "+18885551234",
  "to": "+12125551234",
  "status": "delivered",
  "segments": 1,
  "created_at": "2026-06-18T12:00:00.000000",
  "updated_at": "2026-06-18T12:00:03.000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx message UUID |
| `from` | `string` | Toll-free sending number |
| `to` | `string` | Destination number |
| `status` | `string` | Latest known status (`queued`, `sent`, `delivered`, `failed`) |
| `segments` | `integer` | Estimated segment count |
| `created_at` | `string` | ISO-8601 UTC creation timestamp |
| `updated_at` | `string` | ISO-8601 UTC timestamp of last status update |

**Try it:**

```bash
curl http://localhost:5000/sms/status/40000000-0000-0000-0000-000000000000
```

---

## `GET /sms/messages`

List every message sent during the current process lifetime.

### Response `200`

```json
{
  "count": 1,
  "messages": [
    {
      "id": "40000000-0000-0000-0000-000000000000",
      "from": "+18885551234",
      "to": "+12125551234",
      "status": "delivered",
      "segments": 1,
      "created_at": "2026-06-18T12:00:00.000000",
      "updated_at": "2026-06-18T12:00:03.000000"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `count` | `integer` | Number of messages tracked |
| `messages` | `array<object>` | Message records (same shape as `GET /sms/status/<id>`) |

**Try it:**

```bash
curl http://localhost:5000/sms/messages
```

---

## `POST /webhooks/message-status`

Telnyx-only endpoint that receives delivery status receipts. You do not call this
directly — configure it as the outbound webhook URL on your Messaging Profile.

The raw request body and headers are verified against `TELNYX_PUBLIC_KEY` using the
Telnyx SDK (`client.webhooks.unwrap`) **before** the body is parsed. Requests with a
missing or invalid signature receive `401`.

### Request (sent by Telnyx)

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40000000-0000-0000-0000-000000000000",
      "to": [
        { "phone_number": "+12125551234", "status": "delivered" }
      ]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Webhook event type (e.g. `message.finalized`) |
| `data.payload.id` | `string` | Telnyx message UUID |
| `data.payload.to` | `array<object>` | Recipients; the first entry's `status` is applied |

### Response `200`

```json
{ "status": "received" }
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
| `400` | Bad request — missing or invalid fields / empty body |
| `401` | Invalid API key, or invalid webhook signature |
| `404` | Message ID not found |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Network error reaching Telnyx |

Error responses never include raw exception text; details are logged server-side only.
