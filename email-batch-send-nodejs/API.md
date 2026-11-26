# API Reference — email-batch-send-nodejs

## Routes

### `GET /`

Serve the single-page dashboard.

**Response:** HTML page

---

### `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-11-19T10:00:00.000Z"
}
```

---

### `GET /api/config`

Returns masked sender/recipient addresses for display.

**Response:**

```json
{
  "from": "o***@m***.com",
  "to": "y***@e***.com"
}
```

---

### `POST /api/send-batch`

Trigger a batch email send via the Telnyx Email Batch API.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `count` | `number` | `10` | Number of emails to send (1–1000) |
| `subject` | `string` | `"Telnyx Batch Email Demo"` | Subject line prefix |

```bash
curl -X POST http://localhost:3000/api/send-batch \
  -H "Content-Type: application/json" \
  -d '{"count": 100, "subject": "Newsletter"}'
```

**Response (200):**

```json
{
  "batch_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "count": 100,
  "succeeded": 98,
  "failed": 2,
  "errors": [
    { "index": 42, "code": "invalid_recipient", "message": "..." }
  ]
}
```

**Response (502):**

```json
{
  "error": "Batch send failed",
  "detail": "..."
}
```

---

### `GET /api/batches`

List all batches with summary stats.

**Response:**

```json
{
  "batches": [
    {
      "id": "a1b2c3d4-...",
      "batch_size": 100,
      "succeeded": 98,
      "failed": 2,
      "subject": "Newsletter",
      "status": "sending",
      "created_at": "2026-11-19 10:00:00",
      "event_count": 245
    }
  ]
}
```

---

### `GET /api/batches/:id`

Single batch detail with all messages.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string` | Batch UUID |

**Response (200):**

```json
{
  "batch": {
    "id": "a1b2c3d4-...",
    "batch_size": 100,
    "succeeded": 98,
    "failed": 2,
    "subject": "Newsletter",
    "status": "sending",
    "created_at": "2026-11-19 10:00:00"
  },
  "messages": [
    {
      "id": "msg-abc123",
      "batch_id": "a1b2c3d4-...",
      "recipient": "user@example.com",
      "status": "delivered",
      "created_at": "2026-11-19 10:00:00"
    }
  ]
}
```

**Response (404):**

```json
{ "error": "Batch not found" }
```

---

### `GET /api/batches/:id/events`

Events for a specific batch.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string` | Batch UUID |

**Response:**

```json
{
  "events": [
    {
      "id": 1,
      "message_id": "msg-abc123",
      "batch_id": "a1b2c3d4-...",
      "event_type": "delivered",
      "recipient": "user@example.com",
      "occurred_at": "2026-11-19T10:00:07.000Z",
      "created_at": "2026-11-19 10:00:07"
    }
  ]
}
```

---

### `GET /api/report`

Aggregate performance report across all batches or filtered by batch.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `batch_id` | `string` | Optional — filter to a single batch |

**Response:**

```json
{
  "total_sent": 1000,
  "counts": {
    "delivered": 980,
    "opened": 450,
    "clicked": 120,
    "bounced": 15,
    "failed": 5,
    "complained": 0
  },
  "rates": {
    "delivery": 98.0,
    "open": 45.9,
    "click": 12.2,
    "bounce": 1.5
  }
}
```

---

### `POST /webhooks/email`

Telnyx email webhook receiver. Accepts delivery lifecycle events.

**Request body** (from Telnyx):

```json
{
  "data": {
    "event_type": "email.delivered",
    "payload": {
      "message_id": "msg-abc123",
      "to": "user@example.com",
      "occurred_at": "2026-11-19T10:00:07.000Z"
    }
  }
}
```

**Handled event types:**

| Event | Description |
|-------|-------------|
| `delivered` | Message accepted by recipient mail server |
| `opened` | Recipient opened the email (tracking pixel) |
| `clicked` | Recipient clicked a tracked link |
| `bounced` | Recipient mail server rejected the message |
| `failed` | Delivery failed permanently |
| `complained` | Recipient marked the message as spam |

**Response:**

```json
{ "status": "ok" }
```

---

### `GET /stream`

Server-Sent Events (SSE) stream for real-time dashboard updates.

**Event format:**

```
data: {"type":"event.received","ts":"...","event_type":"delivered","message_id":"msg-abc123","batch_id":"a1b2c3d4-...","progress":{"batch_id":"...","batch_size":100,"delivered":50,"pct":50.0}}
```

**Event types:**

| Type | Description |
|------|-------------|
| `batch.started` | A new batch send was initiated |
| `event.received` | A webhook event was processed |

**Keepalive:** `: keepalive\n\n` every 30 seconds.
