## `POST /mms/send`

Send a single MMS picture message (text plus one or more media attachments) via Telnyx.

### Request

`Content-Type: application/json`

```json
{
  "to": "+12125559999",
  "message": "Check this out!",
  "media_urls": ["https://example.com/image.jpg"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |
| `message` | `string` | **yes** | Message body to send (mapped to the Telnyx `text` field) |
| `media_urls` | `string[]` | **yes** | Array of publicly accessible media URLs to attach. Must contain at least one entry |

### Response `200`

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999",
  "media_count": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Telnyx message ID (`response.data.id`) |
| `status` | `string` | Delivery status of the first recipient, or `"unknown"` if unavailable |
| `from` | `string` | Sending number (`TELNYX_PHONE_NUMBER`) |
| `to` | `string` | Destination number as provided |
| `media_count` | `number` | Number of media attachments sent |

**Try it:**

```bash
curl -X POST http://localhost:5000/mms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Check this out!", "media_urls": ["https://example.com/image.jpg"]}'
```

---

## `GET /health`

Liveness probe. Takes no parameters.

### Response `200`

```json
{
  "status": "ok"
}
```

---

## Error Handling

All responses are JSON. On error the body is `{"error": "..."}` (Telnyx API errors also include `status_code`). Exception details are logged server-side and never returned in the response body.

| Status | Meaning | Trigger |
|--------|---------|---------|
| `200` | Success | Message accepted by Telnyx |
| `400` | Bad request | Missing `to`/`message`/`media_urls`, `media_urls` not an array, non-E.164 number, empty `media_urls`, or unset `TELNYX_PHONE_NUMBER` |
| `401` | Unauthorized | Invalid `TELNYX_API_KEY` (`Telnyx.AuthenticationError`) |
| `429` | Rate limited | Too many requests (`Telnyx.RateLimitError`) |
| `500` | Server error | Unexpected error |
| `503` | Service unavailable | Network error reaching Telnyx (`Telnyx.APIConnectionError`) |

Telnyx `APIError` responses are returned with the upstream `status_code` and a generic `"Failed to send MMS"` message.

---

## Telnyx API Endpoints Called

| Method | Path | SDK call | Purpose |
|--------|------|----------|---------|
| `POST` | `/v2/messages` | `client.messages.send({ from, to, text, media_urls })` | Send the MMS (text + media) |

- [Send Message API reference](https://developers.telnyx.com/api/messaging/send-message)
