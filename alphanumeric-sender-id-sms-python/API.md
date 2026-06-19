## `POST /sms/send-alphanumeric`

Send an SMS with an alphanumeric sender ID via the Telnyx Messaging API.

### Request

```json
{
  "to": "+447700900123",
  "message": "Your ACME order has shipped.",
  "sender_id": "ACME Corp"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Recipient phone number in E.164 format (non-US/CA) |
| `message` | `string` | **yes** | Message content to send |
| `sender_id` | `string` | no | Alphanumeric sender ID (1–11 chars: letters, numbers, spaces). Falls back to `ALPHANUMERIC_SENDER_ID` if omitted |

### Response `200`

```json
{
  "message_id": "40000000-0000-0000-0000-000000000000",
  "status": "queued",
  "from": "ACME Corp",
  "to": "+447700900123",
  "direction": "outbound"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message UUID |
| `status` | `string` | Delivery status for the recipient (e.g. `queued`) |
| `from` | `string` | The alphanumeric sender ID used |
| `to` | `string` | Recipient number (E.164) |
| `direction` | `string` | Message direction (`outbound`) |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/send-alphanumeric \
  -H "Content-Type: application/json" \
  -d '{"to": "+447700900123", "message": "Your ACME order has shipped.", "sender_id": "ACME Corp"}'
```

---

## `POST /sms/validate-sender-id`

Validate an alphanumeric sender ID format locally. Does not call the Telnyx API.

### Request

```json
{
  "sender_id": "ACME Corp"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sender_id` | `string` | **yes** | Candidate alphanumeric sender ID to validate |

### Response `200`

```json
{
  "sender_id": "ACME Corp",
  "is_valid": true,
  "message": "Valid alphanumeric sender ID"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sender_id` | `string` | Echo of the submitted sender ID |
| `is_valid` | `boolean` | `true` if 1–11 alphanumeric/space characters |
| `message` | `string` | Human-readable validation result |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/validate-sender-id \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "ACME Corp"}'
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing/invalid fields, bad sender ID, or unsupported region |
| `401` | Invalid API key |
| `429` | Rate limit exceeded |
| `503` | Network error connecting to Telnyx |
