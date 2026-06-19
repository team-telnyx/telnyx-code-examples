# API Reference — SMS Delivery Receipts

All endpoints accept and return JSON. The server listens on `PORT` (default `3000`).

---

## `POST /sms/send`

Send an SMS and start tracking its delivery receipt.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from Telnyx!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format |
| `message` | `string` | **yes** | Message text to send |

### Response `200`

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message UUID; use it to look up the receipt |
| `status` | `string` | Initial status (typically `queued`) |
| `from` | `string` | Sender number (`TELNYX_PHONE_NUMBER`) |
| `to` | `string` | Destination number |

### Try it

```bash
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

---

## `POST /webhooks/sms`

Receives Telnyx delivery-receipt webhooks. Called by Telnyx, not by your app.

Every request must carry a valid Telnyx signature. The handler verifies the raw
request body against `TELNYX_PUBLIC_KEY` using `client.webhooks.unwrap()`.
Requests with a missing or invalid signature receive `401` and are not processed.

### Request headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `telnyx-signature-ed25519` | `string` | **yes** | Ed25519 signature of the raw body |
| `telnyx-timestamp` | `string` | **yes** | Unix timestamp used in the signature |

### Request body

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "to": [
        {
          "phone_number": "+12125551234",
          "status": "delivered"
        }
      ]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Webhook event type; this handler acts on `message.finalized` |
| `data.payload.id` | `string` | Message UUID matched against the tracking store |
| `data.payload.to[].status` | `string` | Final per-recipient status (`delivered`, `failed`, …) |
| `data.payload.to[].error.message` | `string` | Carrier error reason when `status` is `failed` |

### Response `200`

```json
{ "success": true }
```

### Response `401`

```json
{ "error": "invalid signature" }
```

---

## `GET /receipts/:messageId`

Return the tracked status of one message.

### Path parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `messageId` | `string` | **yes** | The `message_id` returned by `POST /sms/send` |

### Response `200`

```json
{
  "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "from": "+15551234567",
  "to": "+12125551234",
  "status": "delivered",
  "sentAt": "2026-06-18T12:00:00.000Z",
  "deliveredAt": "2026-06-18T12:00:08.000Z",
  "failureReason": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Message UUID |
| `from` | `string` | Sender number |
| `to` | `string` | Destination number |
| `status` | `string` | Latest known status |
| `sentAt` | `string` | ISO-8601 timestamp the message was accepted |
| `deliveredAt` | `string \| null` | ISO-8601 timestamp of delivery, else `null` |
| `failureReason` | `string \| null` | Carrier error message when failed, else `null` |

### Try it

```bash
curl http://localhost:3000/receipts/40385f64-5717-4562-b3fc-2c963f66afa6
```

---

## `GET /receipts`

Return all tracked delivery receipts as an array.

### Response `200`

```json
[
  {
    "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
    "from": "+15551234567",
    "to": "+12125551234",
    "status": "delivered",
    "sentAt": "2026-06-18T12:00:00.000Z",
    "deliveredAt": "2026-06-18T12:00:08.000Z",
    "failureReason": null
  }
]
```

### Try it

```bash
curl http://localhost:3000/receipts
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Error responses never include raw exception text; full details are logged
server-side only.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing/invalid fields or unparseable webhook body |
| `401` | Invalid API key (`/sms/send`) or invalid webhook signature (`/webhooks/sms`) |
| `404` | Message ID not found (`/receipts/:messageId`) |
| `429` | Rate limit exceeded |
| `503` | Network error connecting to Telnyx |
| `500` | Server error |
