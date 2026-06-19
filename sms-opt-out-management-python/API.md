# API Reference — SMS Opt-Out Management

All endpoints accept and return JSON. The service runs on `http://localhost:5000` by default.

---

## `POST /sms/send`

Send an SMS. The recipient's opt-out status is checked first; if the number is opted out, the request is rejected with `400` and no message is sent.

### Request

```json
{
  "to": "+12125559999",
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `message` | `string` | **yes** | Message body to send |

### Response `200`

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID |
| `status` | `string` | Delivery status from Telnyx (e.g. `queued`, `sending`) |
| `from` | `string` | Sending Telnyx number |
| `to` | `string` | Destination number |

### Try it

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hello from the API"}'
```

---

## `POST /optout/add`

Add a number to the opt-out list. Idempotent: re-adding an already opted-out number returns `already_opted_out`.

### Request

```json
{
  "phone_number": "+12125559999",
  "reason": "customer request"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Number to opt out (E.164) |
| `reason` | `string` | no | Free-text reason stored for audit |

### Response `200`

```json
{ "phone_number": "+12125559999", "status": "opted_out" }
```

| Field | Type | Description |
|-------|------|-------------|
| `phone_number` | `string` | The number |
| `status` | `string` | `opted_out` or `already_opted_out` |

---

## `POST /optout/remove`

Remove a number from the opt-out list (re-opt-in).

### Request

```json
{ "phone_number": "+12125559999" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Number to re-opt-in (E.164) |

### Response `200`

```json
{ "phone_number": "+12125559999", "status": "opted_in" }
```

---

## `GET /optout/list`

Return every opted-out number, newest first.

### Response `200`

```json
{
  "optouts": [
    {
      "phone_number": "+12125559999",
      "opted_out_at": "2026-06-18 12:00:00",
      "reason": "User replied with: STOP",
      "source": "webhook"
    }
  ],
  "count": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `optouts[].phone_number` | `string` | Opted-out number |
| `optouts[].opted_out_at` | `string` | UTC timestamp the opt-out was recorded |
| `optouts[].reason` | `string \| null` | Reason captured at opt-out time |
| `optouts[].source` | `string` | `api`, `manual`, or `webhook` |
| `count` | `integer` | Total number of opted-out numbers |

---

## `POST /optout/check`

Check whether a single number is opted out.

### Request

```json
{ "phone_number": "+12125559999" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Number to check (E.164) |

### Response `200`

```json
{ "phone_number": "+12125559999", "opted_out": true }
```

| Field | Type | Description |
|-------|------|-------------|
| `phone_number` | `string` | The number checked |
| `opted_out` | `boolean` | `true` if the number is on the opt-out list |

---

## `POST /webhooks/sms`

Inbound message webhook from Telnyx. You configure this URL on your Messaging Profile; Telnyx calls it. The request body is the standard Telnyx event envelope.

The Ed25519 signature (`telnyx-signature-ed25519` / `telnyx-timestamp` headers) is verified against the raw body **before** the payload is parsed. On a `message.received` event whose normalized text is `STOP`, `STOPALL`, `UNSUBSCRIBE`, or `QUIT`, the sender is added to the opt-out list.

### Request (Telnyx envelope, abridged)

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "msg-inbound-123",
      "from": { "phone_number": "+12125559999" },
      "to": [ { "phone_number": "+15551234567" } ],
      "text": "STOP"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event name; only `message.received` is processed |
| `data.payload.id` | `string` | Inbound message ID |
| `data.payload.from.phone_number` | `string` | Sender's number |
| `data.payload.text` | `string` | Message body; checked against opt-out keywords |

### Response `200`

```json
{ "status": "opted_out", "phone_number": "+12125559999" }
```

Other responses: `{"status": "ignored"}` for non-`message.received` events, `{"status": "processed"}` for messages without an opt-out keyword.

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing/invalid fields, or recipient is opted out |
| `401` | Invalid API key (`/sms/send`) or invalid webhook signature (`/webhooks/sms`) |
| `429` | Rate limit exceeded |
| `503` | Network error reaching Telnyx |

Exception details are never returned in the response body; they are logged server-side and a generic message is returned.
