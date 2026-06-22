## `POST /sms/send`

Send a single SMS message via Telnyx.

### Request

`Content-Type: application/json`

```json
{
  "to": "+12125559999",
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |
| `message` | `string` | **yes** | Message body to send (mapped to the Telnyx `text` field) |

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
| `message_id` | `string` | Telnyx message ID (`response.data.id`) |
| `status` | `string` | Delivery status of the first recipient, or `"unknown"` if unavailable |
| `from` | `string` | Sending number (`TELNYX_PHONE_NUMBER`) |
| `to` | `string` | Destination number as provided |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hello from the API"}'
```

---

## Error Handling

All responses are JSON. On error the body is `{"error": "..."}` (Telnyx API errors also include `status_code`).

| Status | Meaning | Trigger |
|--------|---------|---------|
| `200` | Success | Message accepted by Telnyx |
| `400` | Bad request | Missing `to`/`message`, non-E.164 number, or unset `TELNYX_PHONE_NUMBER` |
| `401` | Unauthorized | Invalid `TELNYX_API_KEY` (`Telnyx.AuthenticationError`) |
| `429` | Rate limited | Too many requests (`Telnyx.RateLimitError`) |
| `500` | Server error | Unexpected error |
| `503` | Service unavailable | Network error reaching Telnyx (`Telnyx.APIConnectionError`) |

Telnyx `APIError` responses are returned with the upstream `status_code` and message.

---

## Telnyx API Endpoints Called

| Method | Path | SDK call | Purpose |
|--------|------|----------|---------|
| `POST` | `/v2/messages` | `client.messages.send({ from, to, text })` | Send the SMS |

- [Send Message API reference](https://developers.telnyx.com/api/messaging/send-message)
