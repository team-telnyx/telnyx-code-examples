# API Reference — Receive MMS Webhook

All endpoints are served by `app.py` on `http://localhost:5000`. Responses are JSON.

---

## `POST /webhooks/message`

Receives the Telnyx `message.received` webhook. Telnyx sends this request to your configured Messaging Profile inbound webhook URL — you do not invoke it yourself.

### Signature verification

The handler verifies the request's Ed25519 signature against `TELNYX_PUBLIC_KEY` **before** parsing the body. Requests without a valid signature are rejected with `401` and never processed.

| Header | Type | Description |
|--------|------|-------------|
| `telnyx-signature-ed25519` | `string` | Ed25519 signature of the raw body |
| `telnyx-timestamp` | `string` | Unix timestamp used for replay protection |

### Request body (sent by Telnyx)

The event envelope nests message fields under `data.payload`. `id` and `event_type` stay at the `data` level.

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | `string` | Unique message ID |
| `data.event_type` | `string` | Event type; processed only when `message.received` |
| `data.payload.direction` | `string` | `inbound` for received messages |
| `data.payload.from.phone_number` | `string` | Sender (E.164) |
| `data.payload.to` | `array` | Recipient objects; first `.phone_number` is used |
| `data.payload.text` | `string` | Message text body |
| `data.payload.received_at` | `string` | ISO 8601 receipt timestamp |
| `data.payload.media` | `array` | Media attachments |
| `data.payload.media[].url` | `string` | Signed, short-lived download URL |
| `data.payload.media[].type` | `string` | MIME type (e.g. `image/jpeg`) |

```json
{
  "data": {
    "id": "f5d7a7e0-1234-5678-90ab-cdef12345678",
    "event_type": "message.received",
    "payload": {
      "direction": "inbound",
      "from": { "phone_number": "+12125550100" },
      "to": [{ "phone_number": "+13125550199" }],
      "text": "Check out this photo",
      "received_at": "2026-06-18T12:00:00Z",
      "media": [
        { "url": "https://media.telnyx.com/abc123", "type": "image/jpeg" }
      ]
    }
  }
}
```

### Response `200` — processed

Returned for a valid `message.received` event. Each media attachment is downloaded to `./media/<message_id>_<idx>.<ext>`.

```json
{
  "status": "received",
  "message_id": "f5d7a7e0-1234-5678-90ab-cdef12345678",
  "media_count": 1
}
```

### Response `200` — ignored

Returned for any non-`message.received` event so Telnyx does not retry.

```json
{ "status": "ignored", "event_type": "message.sent" }
```

---

## `GET /messages`

Lists media files downloaded into `./media/`. Demonstration only — back this with a database in production.

### Response `200`

| Field | Type | Description |
|-------|------|-------------|
| `count` | `integer` | Number of downloaded files |
| `messages` | `array` | File entries |
| `messages[].filename` | `string` | File name on disk |
| `messages[].path` | `string` | Relative path under `media/` |

```json
{
  "count": 1,
  "messages": [
    { "filename": "f5d7a7e0-1234-5678-90ab-cdef12345678_0.jpeg", "path": "media/f5d7a7e0-1234-5678-90ab-cdef12345678_0.jpeg" }
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/messages
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "healthy" }
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Error detail is logged server-side and never echoed in the response body.

| Status | Meaning |
|--------|---------|
| `200` | Success (event processed or intentionally ignored) |
| `400` | Bad request — empty or invalid body |
| `401` | Invalid or missing Telnyx webhook signature |
| `500` | Server error |
