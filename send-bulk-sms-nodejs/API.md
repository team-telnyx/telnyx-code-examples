## `POST /sms/send-bulk`

Send SMS to a list of recipients. Each recipient is sent individually with a configurable delay between calls (`RATE_LIMIT_DELAY_MS`, default `100`ms). The response reports per-message success and failure rather than failing the whole batch.

### Request

```json
{
  "recipients": [
    { "to": "+12125551234", "message": "Hello from Telnyx!" },
    { "to": "+13105556789", "message": "Second message" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipients` | `array` | **yes** | Non-empty array of recipient objects |
| `recipients[].to` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `recipients[].message` | `string` | **yes** | Message content to send |

### Response `200`

```json
{
  "summary": {
    "total": 2,
    "successful": 1,
    "failed": 1
  },
  "successful": [
    {
      "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "status": "queued",
      "from": "+15551234567",
      "to": "+12125551234"
    }
  ],
  "failed": [
    {
      "to": "13105556789",
      "error": "Phone number must be in E.164 format (e.g., +15551234567)",
      "index": 1
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `summary.total` | `number` | Number of recipients submitted |
| `summary.successful` | `number` | Count of messages accepted by Telnyx |
| `summary.failed` | `number` | Count of messages that failed |
| `successful[]` | `array` | One object per accepted message (`message_id`, `status`, `from`, `to`) |
| `failed[]` | `array` | One object per failed message (`to`, `error`, `index`) |

**Try it:**

```bash
curl -X POST http://localhost:3000/sms/send-bulk \
  -H "Content-Type: application/json" \
  -d '{"recipients":[{"to":"+12125551234","message":"Hello from Telnyx!"}]}'
```

---

## `POST /sms/send-single`

Send a single SMS message. Useful for validating credentials before a bulk batch.

### Request

```json
{
  "to": "+12125551234",
  "message": "Hello from Telnyx!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |
| `message` | `string` | **yes** | Message content to send |

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
| `message_id` | `string` | Telnyx message ID |
| `status` | `string` | Delivery status of the first recipient (e.g. `queued`), or `unknown` |
| `from` | `string` | Sending Telnyx number |
| `to` | `string` | Destination number |

**Try it:**

```bash
curl -X POST http://localhost:3000/sms/send-single \
  -H "Content-Type: application/json" \
  -d '{"to":"+12125551234","message":"Hello from Telnyx!"}'
```

---

## `GET /health`

Health check.

### Response `200`

```json
{ "status": "ok" }
```

---

## Telnyx API Endpoints Called

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| `POST` | `/v2/messages` | Send one SMS message (called once per recipient) | [Send a message](https://developers.telnyx.com/api-reference/messages/send-a-message) |

Invoked in code via the Node.js SDK: `client.messages.send({ from, to, text })`.

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing/invalid fields or non-E.164 number |
| `401` | Invalid Telnyx API key |
| `429` | Telnyx rate limit exceeded |
| `503` | Network error connecting to Telnyx |
| `500` | Server error |
