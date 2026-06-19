# API Reference — SMS Auto-Reply Bot

All endpoints accept and return JSON. The server listens on `PORT` (default `3000`).

---

## `POST /webhooks/sms`

Receives inbound message webhooks from Telnyx. The signature is verified before
any processing; only `message.received` events trigger an auto-reply.

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `telnyx-signature-ed25519` | `string` | **yes** | Ed25519 signature of the raw body, set by Telnyx |
| `telnyx-timestamp` | `string` | **yes** | Unix timestamp the event was signed, set by Telnyx |

### Request body

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+12125551234" },
      "text": "What are your hours?"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | `string` | **yes** | Event name. Only `message.received` triggers a reply |
| `data.payload.from.phone_number` | `string` | **yes** | Sender number (E.164); reply is sent here |
| `data.payload.text` | `string` | no | Inbound message body, used to choose the reply |

### Reply selection

| Inbound text contains | Reply |
|-----------------------|-------|
| `help` | `Help is on the way! Our team will contact you soon.` |
| `hours` | `We are open Monday-Friday, 9 AM - 5 PM EST.` |
| anything else | `Thank you for your message. We will respond shortly.` |

### Response `200` — reply sent

```json
{ "success": true, "message_id": "msg-f5d7a7e0-1234-5678" }
```

### Response `200` — acknowledged, no reply

Returned for non-`message.received` events or payloads without a sender.

```json
{ "acknowledged": true }
```

### Response `401` — signature verification failed

```json
{ "error": "invalid signature" }
```

---

## `POST /sms/send`

Send a single SMS. Intended for manual testing.

### Request body

```json
{ "to": "+12125551234", "message": "Hello from Telnyx!" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |
| `message` | `string` | **yes** | Message content to send |

### Response `200`

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### Response `400` — missing fields

```json
{ "error": "Missing required fields: 'to' and 'message'" }
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

Errors return JSON with a generic message; exception details are logged
server-side and never included in responses.

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success (or acknowledged event) |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid webhook signature, or authentication failure when sending |
| `429` | Telnyx rate limit exceeded |
| `502` | Upstream Telnyx API error |
| `503` | Network error connecting to Telnyx |
| `500` | Unexpected server error |
