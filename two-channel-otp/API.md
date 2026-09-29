```markdown
# API Reference — Two-Channel OTP

Typed endpoint reference for the `two-channel-otp` sample.

---

## POST /issue

Issues a 6-digit verification code for a user and delivers it via SMS. The code is stored durably in the `AuthSession` actor (keyed by the user's E.164) and an expiry timer is scheduled.

### Request Body

| Field      | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `userE164` | string | Yes      | The customer's phone number in E.164 format.     |

### Example Request

```bash
curl -X POST http://localhost:8787/issue \
  -H "Content-Type: application/json" \
  -d '{"userE164": "+15551234567"}'
```

### Response

**Status: 200 OK**

```json
{
  "ok": true,
  "expiresInMs": 120000
}
```

| Field          | Type    | Description                                           |
|----------------|---------|-------------------------------------------------------|
| `ok`           | boolean | Always `true` on success.                             |
| `expiresInMs`  | number  | Milliseconds until the code expires (default 120000). |

---

## POST /webhook

Inbound webhook endpoint for Telnyx Call Control events. The actor processes `call.initiated` events to capture the spoken or DTMF-entered code from the caller.

### Request Body

The webhook payload is a standard Telnyx event envelope. The handler reads `event` and `data.payload` fields.

| Field (path)              | Type   | Description                                                        |
|---------------------------|--------|--------------------------------------------------------------------|
| `event`                   | string | The Telnyx event type (e.g. `call.initiated`).                     |
| `data.payload.call_control_id` | string | The call control ID for the inbound call.                       |
| `data.payload.from.e164`  | string | The caller's E.164 number — used to address the `AuthSession` actor.|

### Example Request (from Telnyx)

```bash
curl -X POST http://localhost:8787/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "call.initiated",
    "data": {
      "payload": {
        "call_control_id": "C1234567890",
        "from": { "e164": "+15551234567" }
      }
    }
  }'
```

### Response

**Status: 200 OK**

```json
{
  "ok": true
}
```

---

## Status Codes

| Code | Meaning                                                                 |
|------|-------------------------------------------------------------------------|
| 200  | Success — the request was processed.                                    |
| 400  | Bad Request — invalid JSON or `userE164` missing/invalid format.        |
| 404  | Not Found — the requested route does not exist.                         |
| 500  | Internal Server Error — an unexpected error occurred during processing. |

### 400 Example

```json
{
  "error": "userE164 is required and must be E.164"
}
```

### 404 Example

```json
{
  "error": "Not found"
}
```

---

## Actor RPC: `issue(user)`

Invoked internally by the HTTP `/issue` route and by `onCallStart` when re-issuing a code. Not directly HTTP-accessible.

### Parameters

| Field | Type   | Description                              |
|-------|--------|------------------------------------------|
| `user`| string | The user's E.164 number (session key).   |

### Returns

```json
{
  "ok": true,
  "expiresInMs": 120000
}
```

---

## Actor RPC: `onCallStart(callerE164, callControlId)`

Invoked when an inbound call arrives at the verification line. Addresses the `AuthSession` actor by caller E.164, validates the session, and captures the code via STT (primary) or DTMF (fallback).

### Parameters

| Field           | Type   | Description                                      |
|-----------------|--------|--------------------------------------------------|
| `callerE164`    | string | The caller's E.164 number.                       |
| `callControlId` | string | The Telnyx call control ID for the inbound call. |

### Returns

`void` — the actor speaks the result to the caller via Call Control.

---

## Actor RPC: `lock(user, callId?)`

Invoked after 3 failed verification attempts. Sets session status to `locked`, inserts a row into the `locks` SQL table, and sends an SMS alert to the security on-call number.

### Parameters

| Field     | Type     | Required | Description                              |
|-----------|----------|----------|------------------------------------------|
| `user`    | string   | Yes      | The user's E.164 number.                 |
| `callId`  | string   | No       | The call control ID (for audit trail).   |

### Returns

`void`

---

## Actor RPC: `expire()`

Scheduled task handler — fires after `CODE_TTL_SECONDS` (default 120s). Voids the pending code if the session is still `open`.

### Parameters

None.

### Returns

`void`

---

## Actor RPC: `reissueOrLock()`

Called on a code mismatch or expiry. Re-issues a fresh code (bounded by `MAX_FAILURES`) or locks the session if the failure threshold is reached.

### Parameters

None.

### Returns

`void`

---

## Environment Variables

| Variable                  | Description                                              | Default |
|---------------------------|----------------------------------------------------------|---------|
| `TELNYX_API_KEY`          | Telnyx API key (used by the platform-injected binding).  | —       |
| `VERIFICATION_LINE_E164`  | The E.164 number of the inbound verification line.       | —       |
| `SECURITY_REVIEW_E164`    | The on-call security number to page on lock.             | —       |
| `STT_TIMEOUT_MS`          | Timeout for STT capture before falling back to DTMF.     | `6000`  |
| `CODE_TTL_SECONDS`        | Code time-to-live in seconds.                            | `120`   |
| `MAX_FAILURES`          | Failed attempts before locking the session.              | `3`     |
| `DEMO_MODE`               | When `"true"` (default), no real SMS/calls are placed.   | `true`  |
```
