# API Reference

This service exposes a single HTTP endpoint that initiates an outbound call through Telnyx Call Control.

## `POST /calls/dial`

Initiate an outbound call from your Telnyx number to a destination number.

### Request

```json
{
  "to": "+12125551234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |

The originating number (`from`) and the Call Control Application (`connection_id`) are read from the server environment (`TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID`) and are not part of the request body.

### Response `200`

```json
{
  "call_control_id": "v3:abc123def456...",
  "from": "+15551234567",
  "to": "+12125551234",
  "state": "initiated"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | Telnyx identifier for the call, used in subsequent call control commands |
| `from` | `string` | Originating Telnyx number (E.164) |
| `to` | `string` | Destination number that was dialed (E.164) |
| `state` | `string` | Call state returned by Telnyx; defaults to `initiated` |

### Try it

```bash
curl -X POST http://localhost:5000/calls/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

---

## Error Handling

All responses are JSON. On error the body has the shape `{"error": "..."}` (the `APIError` case also includes a `status_code` field).

| Status | Meaning | When it happens |
|--------|---------|-----------------|
| `200` | Success | Call was initiated |
| `400` | Bad request | Missing `to`, non-E.164 number, or a missing required environment variable (`TELNYX_PHONE_NUMBER` / `TELNYX_CONNECTION_ID`) |
| `401` | Invalid API key | Telnyx `AuthenticationError` — `TELNYX_API_KEY` is wrong |
| `429` | Rate limit exceeded | Telnyx `RateLimitError` |
| `503` | Network error connecting to Telnyx | Telnyx `APIConnectionError` |
| _passthrough_ | Telnyx API status error | Telnyx `APIError` — responds with the upstream `status_code` |
| `500` | Internal server error | Unhandled error |

---

## Telnyx API Endpoints Called

The server calls the Telnyx API through the Node.js SDK.

| SDK call | HTTP | Path | Purpose |
|----------|------|------|---------|
| `client.calls.dial({ from, to, connection_id })` | `POST` | `/v2/calls` | Initiate an outbound call. `connection_id` is **required** and links the call to your Call Control Application; `call_control_id` is **returned** in the response — do not pass it as input. |

See the [Dial API reference](https://developers.telnyx.com/api-reference/call-commands/dial).
