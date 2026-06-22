## `POST /sms/send`

Send a single SMS message via the Telnyx Messaging API.

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
| `message` | `string` | **yes** | Message content to send |

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
| `message_id` | `string` | Telnyx message ID (`response.Data.ID`) |
| `status` | `string` | Delivery status of the first recipient, or `unknown` if unavailable |
| `from` | `string` | The `TELNYX_PHONE_NUMBER` the message was sent from |
| `to` | `string` | The destination number echoed back |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hello from the API"}'
```

---

## Telnyx Endpoints Called

The handler calls one Telnyx endpoint through the Go SDK:

| SDK call | HTTP | Telnyx endpoint |
|----------|------|-----------------|
| `client.Messages.Send(ctx, params)` | `POST` | `/v2/messages` |

`MessageSendParams` is populated with `From` (from `TELNYX_PHONE_NUMBER`), `To`, and `Text`.

---

## Error Handling

All responses are JSON. On error the body is `{"error": "..."}`. Telnyx API failures surface as `*telnyx.Error`, matched with `errors.As`; the handler returns the error's `StatusCode`:

| Status | Trigger | Body |
|--------|---------|------|
| `200` | Message accepted by Telnyx | success object above |
| `400` | Missing `to`/`message`, or non-E.164 number, or other validation error | `{"error": "Missing required fields: 'to' and 'message'"}` / `{"error": "phone number must be in E.164 format (e.g., +15551234567)"}` |
| varies | `*telnyx.Error` — any Telnyx API error, matched via `errors.As`; the response uses the error's `StatusCode` (e.g. `401` for an invalid API key, `429` when rate limited) | `{"error": "<message>", "status_code": <StatusCode>}` |
