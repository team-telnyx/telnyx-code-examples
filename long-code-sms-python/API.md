# API Reference — Long Code SMS

All endpoints accept and return JSON. The application listens on `http://localhost:5000`.

---

## `POST /sms/send`

Send a single SMS immediately, bypassing the queue.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from a Telnyx long code!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `message` | `string` | **yes** | Message body to send |

### Response `200`

```json
{
  "message_id": "40385fa2-1234-5678-9abc-def012345678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID, usable with `GET /sms/status/<message_id>` |
| `status` | `string` | Initial recipient status (e.g. `queued`, `sending`) |
| `from` | `string` | The long code the message was sent from |
| `to` | `string` | Destination number |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from a Telnyx long code!"}'
```

---

## `POST /sms/queue`

Queue a message for batch sending. Enforces a per-recipient rate limit of 1 message/second and a max queue size of 1000.

### Request

```json
{
  "to": "+12125551234",
  "message": "Queued message",
  "metadata": {"campaign": "welcome"}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |
| `message` | `string` | **yes** | Message body to send |
| `metadata` | `object` | no | Arbitrary key/value data tracked alongside the message |

### Response `202`

```json
{
  "queued": true,
  "position": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `queued` | `boolean` | Always `true` on success |
| `position` | `integer` | 1-based position in the queue |

### Try it

```bash
curl -X POST http://localhost:5000/sms/queue \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Queued message"}'
```

---

## `POST /sms/queue/process`

Drain the queue, sending each message via the Telnyx Messaging API. Per-message failures are reported individually and do not abort the run.

### Request

No body.

### Response `200`

```json
{
  "processed": 1,
  "failed": 0,
  "results": [
    {
      "message_id": "40385fa2-1234-5678-9abc-def012345678",
      "status": "queued",
      "from": "+15551234567",
      "to": "+12125551234"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `processed` | `integer` | Count of messages sent successfully |
| `failed` | `integer` | Count of messages that failed to send |
| `results` | `array<object>` | Per-message result (send result or `{to, error}`) |

### Try it

```bash
curl -X POST http://localhost:5000/sms/queue/process
```

---

## `GET /sms/status/<message_id>`

Return the tracked delivery status for a message ID.

### Path parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message_id` | `string` | **yes** | Message ID returned by a send or carried on a webhook |

### Response `200`

```json
{
  "status": "delivered",
  "direction": "outbound",
  "to": "+12125551234",
  "timestamp": "2026-06-18T12:00:00.000000"
}
```

### Try it

```bash
curl http://localhost:5000/sms/status/40385fa2-1234-5678-9abc-def012345678
```

---

## `POST /webhooks/message`

Receives inbound messages and delivery receipts from Telnyx. The request's Ed25519 signature (`telnyx-signature-ed25519` / `telnyx-timestamp` headers) is verified against the raw body before the payload is parsed. You configure this URL on your Messaging Profile; Telnyx calls it, not you.

### Request (sent by Telnyx)

`message.received` and `message.finalized` events. `event_type` is read at `data.event_type`; message fields are read from `data.payload`.

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385fa2-1234-5678-9abc-def012345678",
      "to": [{"phone_number": "+12125551234", "status": "delivered"}]
    }
  }
}
```

### Response `200`

```json
{"status": "updated"}
```

| event_type | Response body |
|------------|---------------|
| `message.received` | `{"status": "received"}` |
| `message.finalized` | `{"status": "updated"}` |
| other | `{"status": "acknowledged"}` |

---

## `GET /health`

### Response `200`

```json
{
  "status": "healthy",
  "queue_size": 0,
  "tracked_messages": 0
}
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

Exception details are logged server-side and never returned in the response body.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `202` | Accepted — message queued |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key, or invalid webhook signature |
| `404` | Message ID not found |
| `429` | Telnyx rate limit exceeded |
| `503` | Network error reaching Telnyx |
