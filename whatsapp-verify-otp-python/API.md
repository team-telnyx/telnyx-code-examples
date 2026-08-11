# API Reference — WhatsApp Verify OTP

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /verify/start`

Start a WhatsApp OTP verification for a phone number.

### Request

```json
{
  "phone_number": "+12125551234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | E.164 formatted phone number to verify |

### Response `200`

```json
{
  "status": "sent",
  "phone": "+12125551234",
  "channel": "whatsapp"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `sent` on success |
| `phone` | `string` | The phone number the OTP was sent to |
| `channel` | `string` | Delivery channel (`whatsapp`) |

**Try it:**

```bash
curl -X POST http://localhost:5000/verify/start \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

---

## `POST /verify/check`

Submit the OTP code received via WhatsApp for verification.

### Request

```json
{
  "phone_number": "+12125551234",
  "code": "12345"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | The phone number that received the OTP |
| `code` | `string` | **yes** | The OTP code entered by the user |

The server forwards the code along with your `VERIFY_PROFILE_ID` to Telnyx. Telnyx returns a `response_code` that the server maps to a status.

### Response `200` (accepted)

```json
{
  "status": "verified"
}
```

### Response `200` (rejected)

```json
{
  "status": "rejected",
  "response_code": "rejected"
}
```

`response_code` can be one of:

| `response_code` | Meaning |
|-----------------|---------|
| `accepted` | Code is correct — verification successful |
| `rejected` | Code is incorrect |
| `expired` | Verification timed out (exceeded `timeout_secs`) |
| `max_attempts_exceeded` | Too many incorrect attempts |

**Try it:**

```bash
curl -X POST http://localhost:5000/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234", "code": "12345"}'
```

---

## `POST /webhooks/verify`

Inbound webhook endpoint called by Telnyx when a verification event occurs.

### Webhook Events

| Event | Description |
|-------|-------------|
| `verify.sent` | OTP message sent to the upstream provider |
| `verify.delivered` | OTP message delivered to the user's device |
| `verify.failed` | Delivery or verification failed |

Signature verification is optional — set `VERIFY_WEBHOOK_SIGNATURE=true` and `TELNYX_PUBLIC_KEY` in `.env` to enable.

### Request (from Telnyx)

```json
{
  "data": {
    "event_type": "verify.delivered",
    "payload": {
      "phone_number": "+12125551234"
    }
  }
}
```

### Response `200`

```json
{
  "status": "ok"
}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "configured": true,
  "verifications": 0,
  "webhook_events": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `ok` |
| `configured` | `bool` | `true` if both `TELNYX_API_KEY` and `VERIFY_PROFILE_ID` are set |
| `verifications` | `integer` | Number of in-memory verification records |
| `webhook_events` | `integer` | Number of received webhook events |

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Status Values

Verification records use these status values: `pending`, `sent`, `delivered`, `verified`, `failed`, `rejected`

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success (check `status` field for accepted/rejected on `/verify/check`) |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key or invalid webhook signature |
| `422` | Telnyx rejected the request — check error response body |
| `500` | Server error |
