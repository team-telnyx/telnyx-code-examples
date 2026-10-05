# API Reference — Step-Up Verify Gate

## Overview

The Step-Up Verify Gate exposes three HTTP endpoints that route to a durable `VerifyGate` actor (one per phone number). The actor runs Number Lookup on every challenge, compares against a SQL ledger baseline, and either issues SMS verification (clean path) or step-up flash-call/voice verification (SIM-swap detected).

All endpoints accept and return JSON. Phone numbers must be in E.164 format (e.g., `+15551234567`).

---

## Endpoints

### 1. Challenge (Login Gate)

Initiates a verification challenge for a phone number. The actor runs Number Lookup, compares against the ledger baseline, and triggers either SMS verification (clean) or step-up flash-call/voice verification (SIM-swap detected).

**Method:** `POST`  
**Path:** `/challenge`

#### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `phone`   | string | Yes      | Phone number in E.164 format (e.g., `+15551234567`) |

#### Request Body

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `userE164` | string | Yes      | Phone number in E.164 format. Must start with `+`. |

#### Example Request

```bash
curl -X POST "https://<your-worker-url>/challenge?phone=%2B15551234567" \
  -H "Content-Type: application/json" \
  -d '{"userE164": "+15551234567"}'
```

#### Response Schema

**Status 200 — Challenge initiated**

| Field            | Type    | Description |
|------------------|---------|-------------|
| `ok`             | boolean | Always `true` on success. |
| `step_up`        | boolean | `true` if step-up verification was triggered (SIM-swap detected). |
| `method`         | string  | Verification method used: `"sms"`, `"flashcall"`, or `"call"`. |
| `verification_id`| string  | Telnyx verification ID (or demo ID in demo mode). |
| `locked`         | boolean | Present only if the number is locked for manual review. |

**Status 400 — Bad request**

| Field  | Type   | Description |
|--------|--------|-------------|
| `error`| string | `"Missing phone parameter"` or `"Invalid phone number format"` |

**Status 403 — Number locked**

| Field  | Type   | Description |
|--------|--------|-------------|
| `ok`   | boolean | `false` |
| `error`| string | `"Number locked for manual review"` |
| `locked`| boolean | `true` |

#### Example Response (Clean Path)

```json
{
  "ok": true,
  "step_up": false,
  "method": "sms",
  "verification_id": "sms_abc123"
}
```

#### Example Response (Step-Up Path)

```json
{
  "ok": true,
  "step_up": true,
  "method": "flashcall",
  "verification_id": "flashcall_def456"
}
```

#### Example Response (Locked)

```json
{
  "ok": false,
  "error": "Number locked for manual review",
  "locked": true,
  "step_up": true
}
```

---

### 2. Verify Code

Submits a verification code for checking against the Telnyx Verify API. On success, resolves any pending step-up record in the ledger.

**Method:** `POST`  
**Path:** `/verify`

#### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `phone`   | string | Yes      | Phone number in E.164 format |
| `code`    | string | Yes      | Verification code submitted by the user (minimum 4 digits) |

#### Request Body

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `userE164` | string | Yes      | Phone number in E.164 format |
| `code`     | string | Yes      | Verification code (minimum 4 characters) |

#### Example Request

```bash
curl -X POST "https://<your-worker-url>/verify?phone=%2B15551234567&code=123456" \
  -H "Content-Type: application/json" \
  -d '{"userE164": "+15551234567", "code": "123456"}'
```

#### Response Schema

**Status 200 — Code accepted**

| Field          | Type   | Description |
|----------------|--------|-------------|
| `ok`           | boolean | Always `true` |
| `response_code`| string | `"accepted"` |

**Status 200 — Code rejected**

| Field          | Type   | Description |
|----------------|--------|-------------|
| `ok`           | boolean | `false` |
| `response_code`| string | `"rejected"` or the raw response code from Telnyx |

**Status 400 — Bad request**

| Field  | Type   | Description |
|--------|--------|-------------|
| `error`| string | `"Missing phone or code parameter"` or `"Invalid code"` |

#### Example Response (Accepted)

```json
{
  "ok": true,
  "response_code": "accepted"
}
```

#### Example Response (Rejected)

```json
{
  "ok": false,
  "response_code": "rejected"
}
```

---

### 3. Webhook Endpoint

Receives Telnyx Verify webhooks (`verify.sent`, `verify.failed`, `verify.delivered`). The webhook signature is verified using Ed25519. Delivery receipts are logged.

**Method:** `POST`  
**Path:** `/webhook/verify`

#### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `phone`   | string | Yes      | Phone number in E.164 format (used to route to the correct actor) |

#### Request Headers

| Header              | Required | Description |
|---------------------|----------|-------------|
| `Telnyx-Signature`  | Yes      | Ed25519 signature header from Telnyx |
| `Content-Type`      | Yes      | Must be `application/json` |

#### Request Body

The raw webhook payload from Telnyx. The payload structure follows the [Telnyx Verify webhook format](https://developers.telnyx.com/docs/identity/verify/receiving-webhooks).

| Field (in `data.payload`) | Type   | Description |
|---------------------------|--------|-------------|
| `status`                  | string | Verification status (e.g., `"sent"`, `"delivered"`, `"failed"`) |
| `failed_attempts`         | number | Number of failed verification attempts |
| `type`                    | string | Event type (e.g., `"verify.sent"`, `"verify.delivered"`, `"verify.failed"`) |
| `delivery_status`         | string | Optional delivery status detail |

#### Example Request

```bash
curl -X POST "https://<your-worker-url>/webhook/verify?phone=%2B15551234567" \
  -H "Telnyx-Signature: t=1700000000,v1=base64signaturehere" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "status": "delivered",
        "failed_attempts": 0,
        "type": "verify.delivered",
        "delivery_status": "delivered"
      }
    }
  }'
```

#### Response Schema

**Status 200 — Webhook processed**

| Field | Type   | Description |
|-------|--------|-------------|
| (body)| string | `"OK"` |

**Status 401 — Unauthorized (invalid or missing signature)**

| Field | Type   | Description |
|-------|--------|-------------|
| (body)| string | `"Unauthorized"` or `"Invalid signature"` |

**Status 400 — Bad request**

| Field | Type   | Description |
|-------|--------|-------------|
| (body)| string | `"Missing phone parameter"` |

---

## Status Codes Summary

| Code | Meaning | When |
|------|---------|------|
| 200  | OK | Request processed successfully |
| 400  | Bad Request | Missing required parameters, invalid phone format, invalid code |
| 401  | Unauthorized | Webhook signature verification failed |
| 403  | Forbidden | Number is locked for manual review |
| 404  | Not Found | Unknown endpoint path |
| 500  | Internal Server Error | Unexpected server error |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes (live mode) | Telnyx API key for Number Lookup and Verify API calls |
| `VERIFY_PROFILE_ID` | Yes (live mode) | Telnyx Verify profile resource ID |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Yes (live mode) | Ed25519 public key for webhook signature verification |
| `DEMO_MODE` | No | Defaults to `true`. When enabled, no real API calls are made; actions are logged |
| `STEPUP_METHOD` | No | Step-up verification method: `flashcall` (default) or `call` |
| `LOOKUP_CACHE_MIN` | No | Number lookup cache duration in minutes (default: 60) |
| `STEPUP_WINDOW_DAYS` | No | Window for counting repeat step-ups (default: 30) |
| `LOCK_THRESHOLD` | No | Number of step-ups within window to trigger lock (default: 3) |
| `LOCK_HOURS` | No | Lock duration in hours (default: 24) |

---

## Actor State

The `VerifyGate` actor maintains durable state per phone number:

| Field | Type | Description |
|-------|------|-------------|
| `carrierBaseline` | `CarrierSnapshot \| null` | The first carrier snapshot recorded for this number (read from SQL ledger on restart) |
| `stepups` | `StepupRecord[]` | In-memory list of step-up events (also persisted to SQL) |
| `locked` | boolean | Whether the number is currently locked |
| `lockedUntil` | `number \| null` | Unix timestamp (ms) when the lock expires |

### CarrierSnapshot

| Field | Type | Description |
|-------|------|-------------|
| `line_type` | string | `mobile`, `voip`, `landline`, etc. |
| `spid_carrier_name` | string | Carrier name from SPID data |
| `spid_carrier_type` | string | Carrier type (e.g., `wireless`) |
| `at` | number | Unix timestamp (ms) of the snapshot |

### StepupRecord

| Field | Type | Description |
|-------|------|-------------|
| `reason` | string | Reason for step-up (e.g., `carrier_change`) |
| `at` | number | Unix timestamp (ms) of the step-up event |
| `resolved` | boolean | Whether the step-up was resolved (code verified) |

---

## SQL Ledger Schema

The actor persists data to a SQL database (`env.LEDGER`):

### `carrier_history`

| Column | Type | Description |
|--------|------|-------------|
| `number` | TEXT | Phone number (E.164) |
| `at` | INTEGER | Unix timestamp (ms) |
| `spid` | TEXT | Carrier name from SPID |
| `line_type` | TEXT | Line type (`mobile`, `voip`, `landline`) |
| `carrier_name` | TEXT | Carrier name |
| `carrier_type` | TEXT | Carrier type |

### `stepups`

| Column | Type | Description |
|--------|------|-------------|
| `number` | TEXT | Phone number (E.164) |
| `reason` | TEXT | Step-up reason |
| `at` | INTEGER | Unix timestamp (ms) |
| `resolved` | INTEGER | 0 = unresolved, 1 = resolved |

### `demo_carrier`

| Column | Type | Description |
|--------|------|-------------|
| `number` | TEXT | Phone number (E.164) |
| `carrier_name` | TEXT | Simulated carrier name |
| `line_type` | TEXT | Simulated line type |
| `carrier_type` | TEXT | Simulated carrier type |

---

## Demo Mode

By default (`DEMO_MODE=true`), the actor does not make real Telnyx API calls. Instead:

- **Number Lookup** returns a simulated carrier snapshot from the `demo_carrier` table (or defaults to Verizon/mobile if no entry exists).
- **SMS/Flash-call/Voice verification** logs the action and returns a demo verification ID.
- **Code verification** always returns `accepted` in demo mode.

To simulate a SIM-swap, insert a different carrier into the `demo_carrier` table for the target number:

```sql
INSERT INTO demo_carrier (number, carrier_name, line_type, carrier_type)
VALUES ('+15551234567', 'AT&T', 'mobile', 'wireless');
```

To switch to live mode, set `DEMO_MODE=false` and configure `TELNYX_API_KEY`, `VERIFY_PROFILE_ID`, and `TELNYX_WEBHOOK_PUBLIC_KEY`.
