## `POST /auth/request-otp`

Generate a one-time password, deliver it over SMS, and store it for verification. Rate limited to 5 requests per phone number per 15-minute window.

### Request

```json
{
  "phone_number": "+12125551234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Recipient phone number in E.164 format (must start with `+`) |

### Response `200`

```json
{
  "message": "OTP sent successfully",
  "message_id": "msg-f5d7a7e0-1234-5678",
  "expires_in_seconds": 300
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Human-readable status |
| `message_id` | `string` | Telnyx message ID for the sent SMS |
| `expires_in_seconds` | `integer` | OTP lifetime, from `OTP_EXPIRY_SECONDS` |

**Try it:**

```bash
curl -X POST http://localhost:5000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

---

## `POST /auth/verify-otp`

Verify a user-supplied OTP against the stored value. A correct code consumes the OTP and returns a session token. Three incorrect attempts invalidate the OTP.

### Request

```json
{
  "phone_number": "+12125551234",
  "otp": "123456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number the OTP was issued for (E.164) |
| `otp` | `string` | **yes** | The OTP code entered by the user |

### Response `200` (verified)

```json
{
  "message": "OTP verified successfully",
  "authenticated": true,
  "session_token": "session_1718700000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Human-readable status |
| `authenticated` | `boolean` | `true` when the code matched |
| `session_token` | `string` | Placeholder session token (swap for a real JWT in production) |

### Response `401` (not verified)

```json
{
  "message": "Invalid OTP. Please try again.",
  "authenticated": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Reason for failure (invalid, expired, or too many attempts) |
| `authenticated` | `boolean` | Always `false` for this response |

**Try it:**

```bash
curl -X POST http://localhost:5000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234", "otp": "123456"}'
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "ok" }
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Telnyx API Endpoints Called

The application calls the Telnyx Messaging API through the Node.js SDK:

| SDK call | HTTP endpoint | Purpose |
|----------|---------------|---------|
| `client.messages.send({ from, to, text })` | `POST /v2/messages` | Send the OTP SMS to the user |

[Send a Message — API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing fields or non-E.164 phone number |
| `401` | Invalid Telnyx API key, or OTP verification failed |
| `429` | Rate limited — too many OTP requests, or Telnyx rate limit hit |
| `500` | Internal server error |
| `503` | Network error connecting to Telnyx |
