# API Reference: SMS Two-Factor Agent

This document provides a typed reference for the HTTP endpoints exposed by the SMS Two-Factor Agent. The agent manages the lifecycle of 2FA codes — generation, delivery via Telnyx SMS, verification, and expiry.

## Base URL

```
https://<your-function>.telnyxcompute.com
```

Local: the deployed function URL is returned by `telnyx-edge ship` (see `telnyx-edge list`). The example runs on Telnyx Edge Compute; the smoke test (`npm test`) verifies the module contract without an HTTP listener.

## Endpoints

### 1. Initiate 2FA

Generates a 6-digit verification code, stores it in KV with a 5-minute `expirationTtl`, and sends it to the user via the `[telnyx]` binding. Rate-limited to 5 send attempts per phone per 5-minute window (durable, per-phone actor state).

**Endpoint:** `POST /verify`

#### Request Body Schema

| Field   | Type   | Required | Description                                          |
|---------|--------|----------|------------------------------------------------------|
| `phone` | string | Yes      | E.164 formatted phone number (e.g., `+15551234567`) |

#### Example Request

```bash
curl -X POST https://<your-function>.telnyxcompute.com/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567"}'
```

#### Response Schema

**Status 200 OK** — `DEMO_MODE=false` (live mode):

```json
{
  "ok": true,
  "message": "Verification code sent. Check your phone.",
  "demo_mode": false,
  "message_id": "4031a083-1c0b-4fee-a298-e2249ef1f421"
}
```

**Status 200 OK** — `DEMO_MODE=true` (demo mode, code logged to actor console only):

```json
{
  "ok": true,
  "message": "Verification code sent. Check your phone.",
  "demo_mode": true
}
```

**Status 400 Bad Request**

```json
{ "error": "A valid E.164 phone number is required (e.g. +15551234567)" }
```

**Status 429 Too Many Requests**

```json
{ "error": "Too many attempts. Please try again later." }
```

#### Status Codes

| Status Code | Description                                                        |
|-------------|--------------------------------------------------------------------|
| 200         | Code generated, stored, and delivered (or logged in demo mode).    |
| 400         | Missing or malformed `phone` field (not E.164).                    |
| 429         | 5 send attempts already used within the 5-minute window.           |
| 500         | Actor method failure (e.g., KV and storage both unavailable).      |

**Notes:**
- `message_id` is the Telnyx outbound message id — poll `GET /v2/messages/{message_id}` for delivery status.
- The rate-limit window auto-expires: it resets when the scheduled `expireCode` task runs (5 min after send) or on successful verification.

---

### 2. Verify Code

Verifies the user-provided code against the value stored in KV (with the actor's durable storage as fallback). Failed verifications increment a per-phone fail counter; success clears the code and resets counters.

**Endpoint:** `POST /check` (alias: `POST /verify/code`)

#### Request Body Schema

| Field   | Type   | Required | Description                                       |
|---------|--------|----------|---------------------------------------------------|
| `phone` | string | Yes      | E.164 formatted phone number.                     |
| `code`  | string | Yes      | 6-digit verification code received via SMS.       |

#### Example Request

```bash
curl -X POST https://<your-function>.telnyxcompute.com/check \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567", "code": "123456"}'
```

#### Response Schema

**Status 200 OK**

```json
{
  "verified": true,
  "message": "Phone number verified."
}
```

**Status 401 Unauthorized** — wrong code:

```json
{
  "verified": false,
  "error": "Invalid code",
  "status": "invalid",
  "fails_remaining": 4
}
```

**Status 404 Not Found** — no active code (never sent, expired, or already verified):

```json
{ "error": "No active verification code. Request a new one." }
```

**Status 400 Bad Request** — missing fields:

```json
{ "error": "phone and code are required" }
```

#### Status Codes

| Status Code | Description                                                        |
|-------------|--------------------------------------------------------------------|
| 200         | Code matches — phone verified, code and counters cleared.          |
| 400         | Missing `phone` or `code`.                                         |
| 401         | Code does not match; `fails_remaining` decrements from 5.          |
| 404         | No active verification code for this phone.                        |

---

### 3. Health Check

Liveness probe for the deployed function.

**Endpoint:** `GET /health`

#### Example Request

```bash
curl https://<your-function>.telnyxcompute.com/health
```

#### Response Schema

**Status 200 OK**

```json
{
  "status": "ok",
  "agent": "TwoFactorAgent"
}
```

#### Status Codes

| Status Code | Description            |
|-------------|------------------------|
| 200         | Function is serving.   |
| 405         | Non-GET request.       |
