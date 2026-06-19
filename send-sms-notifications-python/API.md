# API Reference

All endpoints accept and return JSON. The notification routes are mounted under the
`/api` prefix.

## `POST /api/notifications/send`

Send an SMS notification and create a tracking record.

### Request

```json
{
  "recipient": "+12125551234",
  "message": "Your order #12345 has shipped",
  "notification_type": "order_update"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipient` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `message` | `string` | **yes** | Message body (max 1600 characters) |
| `notification_type` | `string` | no | Free-form category label; defaults to `alert` |

### Response `201`

```json
{
  "notification_id": 1,
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "recipient": "+12125551234",
  "status": "sent",
  "notification_type": "order_update"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `notification_id` | `integer` | Local id used to look the notification up later |
| `message_id` | `string` | Telnyx message UUID |
| `recipient` | `string` | Destination number |
| `status` | `string` | One of `pending`, `sent`, `delivered`, `failed`, `retry` |
| `notification_type` | `string` | Category label echoed back |

**Try it:**

```bash
curl -X POST http://localhost:5000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"recipient": "+12125551234", "message": "Hello", "notification_type": "alert"}'
```

---

## `GET /api/notifications/{notification_id}`

Fetch a single notification's current status.

| Path param | Type | Required | Description |
|------------|------|----------|-------------|
| `notification_id` | `integer` | **yes** | Local notification id returned by send |

### Response `200`

```json
{
  "id": 1,
  "recipient": "+12125551234",
  "message": "Your order #12345 has shipped",
  "notification_type": "order_update",
  "status": "delivered",
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "retry_count": 0,
  "created_at": "2026-06-18T12:00:00",
  "updated_at": "2026-06-18T12:00:05"
}
```

**Try it:**

```bash
curl http://localhost:5000/api/notifications/1
```

---

## `GET /api/notifications`

List notifications, newest first.

| Query param | Type | Required | Description |
|-------------|------|----------|-------------|
| `status` | `string` | no | Filter by status (`pending`, `sent`, `delivered`, `failed`, `retry`) |
| `limit` | `integer` | no | Max records to return; defaults to `50` |

### Response `200`

```json
{
  "count": 1,
  "notifications": [
    {
      "id": 1,
      "recipient": "+12125551234",
      "status": "delivered",
      "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6"
    }
  ]
}
```

**Try it:**

```bash
curl "http://localhost:5000/api/notifications?status=delivered&limit=10"
```

---

## `POST /api/webhooks/sms`

Receives Telnyx delivery-status events. **The Ed25519 signature is verified against
the raw request body before any parsing.** Requests with a missing or invalid
signature are rejected with `401`.

`event_type` is read from `data.event_type`; the message id and per-recipient
delivery status are read from `data.payload`.

### Request (sent by Telnyx)

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | `message.sent` or `message.finalized` |
| `data.payload.id` | `string` | Telnyx message UUID, matched to a stored notification |
| `data.payload.to[].status` | `string` | Per-recipient delivery status used on `message.finalized` |

### Response `200`

```json
{ "status": "processed" }
```

Always returns `200` once the signature verifies, even if no matching
notification is found, so Telnyx does not retry indefinitely.

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "healthy" }
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
| `201` | Notification created |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key, or invalid webhook signature |
| `404` | Notification not found |
| `429` | Telnyx rate limit exceeded |
| `503` | Network error reaching Telnyx |
