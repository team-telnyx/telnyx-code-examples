# API Reference — `otp-guard`

Typed endpoint contract for the `otp-guard` Telnyx Edge sample. Every route is served by the plain-fetch router in `src/index.ts` and dispatches into the durable `OtpGuard` actor instance identified by `env.OTP_GUARD.idFromName(action_id)`.

Base URL (local / deployed):

```
http://localhost:8787            # telnyx-edge local runtime
https://<your-worker>.<domain>   # after `telnyx-edge ship`
```

---

## Conventions

### Actor identity

Every `/actions/:id/*` route resolves to exactly one actor:

```ts
env.OTP_GUARD.get(env.OTP_GUARD.idFromName(actionId))
```

The same `action_id` always reaches the same session — across requests, across devices, and across worker restarts. There is no session cookie and no cache.

### Path parameter validation

| Parameter | Pattern | Notes |
|---|---|---|
| `:id` (`action_id`) | `^[A-Za-z0-9_-]{1,64}$` | Rejected with `400 invalid_action_id` before any actor is touched. |

### Logical status vs HTTP status

The action routes return **HTTP 200 for every well-formed request**, including denials. The outcome lives in the JSON `status` field (`pending`, `rejected`, `locked`, `expired`, `committed`, …). Only malformed input, unknown routes, and internal faults produce non-200 HTTP codes.

### Common error envelope

```json
{ "error": "invalid_json" }
```

| `error` value | HTTP | Cause |
|---|---|---|
| `invalid_action_id` | 400 | `:id` failed `^[A-Za-z0-9_-]{1,64}$` |
| `invalid_json` | 400 | Body was not a JSON object |
| `phone_number must be E.164, e.g. +15551234567` | 400 | `phone_number` failed `^\+[1-9]\d{7,14}$` |
| `code must be 4-8 digits` | 400 | `code` failed `^\d{4,8}$` |
| `missing_action_id` | 400 | Webhook called without a valid `?action_id=` |
| `invalid_signature` | 401 | Ed25519 signature did not verify |
| `not_found` | 404 | Path did not match any route |
| `method_not_allowed` | 405 | Wrong verb for an existing path |
| `internal_error` | 500 | Unhandled exception (details logged, never returned) |
| `webhook_verification_not_configured` | 503 | `TELNYX_PUBLIC_KEY` secret missing |

### Session status enum

| `status` | Meaning |
|---|---|
| `idle` | No active verification; ready to `start` (also the post-lockout state) |
| `pending` | Verification triggered, code outstanding |
| `committed` | Code accepted, action granted — terminal |
| `locked` | Attempt budget exhausted; `locked_until` is set |
| `expired` | Session clock ran out or the verification id is unknown |

### Demo constants (compiled in, not request-tunable)

| Constant | Value | Effect |
|---|---|---|
| `MAX_ATTEMPTS` | `3` | Attempt budget at trigger and after lockout lift |
| `LOCKOUT_SECONDS` | `600` | Cool-down scheduled via `this.schedule(600, "liftLockout")` |
| `VERIFICATION_TIMEOUT_SECS` | `300` | Actor-side `expires_at` = trigger time + 300 s |
| `DEMO_ACCEPT_CODE` | `"123456"` | Only code accepted when `DEMO_MODE=true` |
| `DEMO_PROFILE_ID` | `"demo-profile-otp-guard"` | Profile id used when `DEMO_MODE=true` |

---

## POST /actions/:id/verify-profile

One-time provisioning of the step-up Verify profile (6-digit codes, 300-second expiry). Idempotent: if the actor already holds a `verify_profile_id`, or `VERIFY_PROFILE_ID` is set in the environment, no profile is created and `created: false` is returned.

### Path parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Action id, `^[A-Za-z0-9_-]{1,64}$`. Becomes the actor name. |

### Request body

None. Any body sent is ignored.

### Example request

```bash
curl -s -X POST http://localhost:8787/actions/action-4471/verify-profile
```

### Response — 200

```json
{
  "ok": true,
  "created": true,
  "verify_profile_id": "demo-profile-otp-guard"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` on success |
| `created` | boolean | `true` if a new profile was created; `false` if one was reused (from actor state or `VERIFY_PROFILE_ID`) |
| `verify_profile_id` | string | Profile id persisted into actor state |

Failure shape (HTTP 200, profile creation threw):

```json
{
  "ok": false,
  "status": "api_error",
  "message": "Could not create the step-up verify profile."
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Profile attached or created (inspect `ok`) |
| 400 | `invalid_action_id` |
| 404 | Route not matched |
| 405 | Method other than `POST` |
| 500 | `internal_error` |

### Side effects

Appends `verify_profile_created` or `verify_profile_attached` to the actor audit trail. When `DEMO_MODE=false` and `PUBLIC_BASE_URL` is set, the created profile registers `webhook_url = ${PUBLIC_BASE_URL}/webhooks/verify?action_id=<id>`.

---

## POST /actions/:id/start

Triggers the verification (`POST /v2/verifications/sms` in live mode) and persists `verify_id`, `expires_at`, and a fresh attempt budget. Also used to re-trigger after `expired`.

### Path parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Action id, `^[A-Za-z0-9_-]{1,64}$` |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `phone_number` | string | no | E.164 destination for the code, `^\+[1-9]\d{7,14}$`. Falls back to the `DEMO_PHONE` env var when omitted. If neither is valid E.164 → `400`. |
| `action_kind` | string | no | Label for the guarded action. Defaults to `"payout_destination_change"`. Truncated to 64 chars. |
| `destination` | string | no | The value the action would commit (e.g. the new payout account). Truncated to 128 chars. Stored in state and echoed back on commit. |

### Example request

```bash
curl -s -X POST http://localhost:8787/actions/action-4471/start \
  -H 'content-type: application/json' \
  -d '{
    "phone_number": "+15551234567",
    "action_kind": "payout_destination_change",
    "destination": "acct_9931"
  }'
```

### Response — 200, triggered

```json
{
  "ok": true,
  "status": "pending",
  "verify_id": "demo-verify-m1x9zq",
  "expires_at": "2026-07-28T13:46:00.000Z",
  "attempts_left": 3
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` when the verification was triggered |
| `status` | string | Always `"pending"` on this shape |
| `verify_id` | string | Verification id persisted into actor state; used by `/submit` |
| `expires_at` | string (ISO 8601) | Trigger time + `VERIFICATION_TIMEOUT_SECS` |
| `attempts_left` | number | Reset to `MAX_ATTEMPTS` (3) |

### Response — 200, denied

| `status` | Extra fields | Meaning |
|---|---|---|
| `committed` | `message` | Action already granted; no new verification is issued |
| `locked` | `locked_until`, `message` | Cool-down still running |
| `no_profile` | `message` | Call `POST /actions/:id/verify-profile` first |
| `rate_limited` | `retry_after_secs`, `message` | Verify returned `429`; `message` renders the wait in whole minutes |
| `api_error` | `message` | Verify returned a non-429 failure |

```json
{
  "ok": false,
  "status": "rate_limited",
  "retry_after_secs": 120,
  "message": "Verification rate limit hit. Try again in 2 minute(s)."
}
```

```json
{
  "ok": false,
  "status": "locked",
  "locked_until": "2026-07-28T14:05:00.000Z",
  "message": "Session locked until 2026-07-28T14:05:00.000Z."
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Triggered or denied — read `ok` / `status` |
| 400 | `invalid_action_id`, `invalid_json`, or non-E.164 `phone_number` |
| 404 | Route not matched |
| 405 | Method other than `POST` |
| 500 | `internal_error` |

### Side effects

Appends `verification_triggered` with result `pending`, `rate_limited`, or `api_error`.

---

## POST /actions/:id/submit

Submits a code against the stored `verify_id` (`POST /v2/verifications/check/{verification_id}` in live mode) and branches on the result. This is the only route that mutates the attempt budget.

### Path parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Action id, `^[A-Za-z0-9_-]{1,64}$` |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | yes | 4–8 digits, `^\d{4,8}$`. In `DEMO_MODE` only `123456` is accepted. |

### Example request

```bash
curl -s -X POST http://localhost:8787/actions/action-4471/submit \
  -H 'content-type: application/json' \
  -d '{"code":"123456"}'
```

### Response — 200, accepted

```json
{
  "ok": true,
  "status": "committed",
  "destination": "acct_9931",
  "committed_at": "2026-07-28T13:41:12.884Z"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` |
| `status` | string | `"committed"` |
| `destination` | string \| null | The value supplied at `/start`, recorded as the granted change |
| `committed_at` | string (ISO 8601) | Commit timestamp, mirrored into the audit trail |

### Response — 200, rejected

```json
{
  "ok": false,
  "status": "rejected",
  "attempts_left": 2,
  "message": "2 attempts remaining."
}
```

### Response — 200, other outcomes

| `status` | Extra fields | Meaning |
|---|---|---|
| `committed` | `message` | Already granted; idempotent replay, no check performed |
| `locked` | `locked_until`, `attempts_left`, `message` | Cool-down active; no check performed, no attempt consumed |
| `no_session` | `message` | No `verify_id` — call `/start` first |
| `expired` | `message` | Actor clock passed `expires_at`, or Verify returned `404` for the id; offers a clean re-trigger |
| `api_error` | `attempts_left`, `message` | Verify unreachable/5xx — **no attempt consumed** |

```json
{
  "ok": false,
  "status": "expired",
  "message": "Verification expired. POST /actions/:id/start to re-trigger."
}
```

```json
{
  "ok": false,
  "status": "api_error",
  "attempts_left": 2,
  "message": "Verification service unavailable. No attempt was consumed."
}
```

### Response — 200, budget exhausted

Returned when the decrement reaches zero. The session locks and a cool-down is scheduled.

```json
{
  "ok": false,
  "status": "locked",
  "locked_until": "2026-07-28T14:05:00.000Z",
  "attempts_left": 0,
  "message": "Locked until 2026-07-28T14:05:00.000Z."
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Any verification outcome — read `ok` / `status` |
| 400 | `invalid_action_id`, `invalid_json`, or `code must be 4-8 digits` |
| 404 | Route not matched |
| 405 | Method other than `POST` |
| 500 | `internal_error` |

### Side effects

Appends `code_submitted` (`accepted` / `rejected` / `expired` / `not_found` / `error`), then `action_committed` on success or `budget_exhausted` on lockout. On commit, sends an SMS confirmation through `env.TELNYX.messages.send` when `DEMO_MODE=false` and `DISPATCH_FROM_NUMBER` is set.

### Concurrency

The actor serializes method calls per instance. Two simultaneous `submit` requests with wrong codes decrement the budget exactly twice — never three times, never once. There is no lock file; actor-native serialization is the mechanism.

---

## GET /actions/:id/audit

Answers "who attempted this, when, and what happened" from the actor's own append-only trail. The phone number is masked before it leaves the actor.

### Path parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Action id, `^[A-Za-z0-9_-]{1,64}$` |

### Request body

None.

### Example request

```bash
curl -s http://localhost:8787/actions/action-4471/audit
```

### Response — 200

```json
{
  "action_kind": "payout_destination_change",
  "status": "committed",
  "phone_number": "+1555***4567",
  "attempts_left": 2,
  "expires_at": "2026-07-28T13:46:00.000Z",
  "locked_until": null,
  "audit": [
    {
      "at": "2026-07-28T13:40:58.112Z",
      "event": "verify_profile_created",
      "result": "ok",
      "detail": { "verify_profile_id": "demo-profile-otp-guard", "code_length": 6, "timeout_secs": 300 }
    },
    {
      "at": "2026-07-28T13:41:00.004Z",
      "event": "verification_triggered",
      "result": "pending",
      "detail": { "verify_id": "demo-verify-m1x9zq", "expires_at": "2026-07-28T13:46:00.000Z" }
    },
    {
      "at": "2026-07-28T13:41:12.884Z",
      "event": "action_committed",
      "result": "accepted",
      "detail": { "destination": "acct_9931", "committed_at": "2026-07-28T13:41:12.884Z" }
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `action_kind` | string | Label captured at `/start` |
| `status` | string | Current session status (see enum above) |
| `phone_number` | string | Masked: first 5 chars + `***` + last 4. `"***"` if the number is ≤ 9 chars |
| `attempts_left` | number | Remaining budget |
| `expires_at` | string \| null | Actor-side expiry clock |
| `locked_until` | string \| null | Cool-down end, when locked |
| `audit` | array | Append-only entries, oldest first |

### Audit entry schema

| Field | Type | Description |
|---|---|---|
| `at` | string (ISO 8601) | Event timestamp |
| `event` | string | See the event table below |
| `result` | string | Outcome for that event |
| `detail` | object | Event-specific payload; `{}` when empty |

### Audit event names

| `event` | `result` values | Emitted by |
|---|---|---|
| `verify_profile_created` | `ok`, `error` | `/verify-profile` |
| `verify_profile_attached` | `ok` | `/verify-profile` (env-supplied profile) |
| `verification_triggered` | `pending`, `rate_limited`, `api_error` | `/start` |
| `code_submitted` | `accepted`, `rejected`, `expired`, `not_found`, `error` | `/submit` |
| `action_committed` | `accepted` | `/submit` (grant) |
| `budget_exhausted` | `locked` | `/submit` (third rejection) |
| `lockout_lifted` | `idle` | scheduled `liftLockout` |
| `webhook:<event_type>` | `payload.status` or `ignored` | `/webhooks/verify` |

### Status codes

| Code | Meaning |
|---|---|
| 200 | Trail returned (possibly empty `audit: []` for a fresh actor) |
| 400 | `invalid_action_id` |
| 404 | Route not matched |
| 405 | Method other than `GET` |
| 500 | `internal_error` |

---

## POST /webhooks/verify

Telnyx Verify profile webhook receiver. Acts as a **second signal** alongside the check response — it is folded into the audit trail and never overrides a check result. Returns immediately; the actor call is synchronous within the request.

### Query parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `action_id` | string | yes | Routes the event to the owning actor. `^[A-Za-z0-9_-]{1,64}$`. Embedded in the profile's `webhook_url` at creation time. |

### Headers

| Header | Required | Description |
|---|---|---|
| `telnyx-signature-ed25519` | yes | Base64 Ed25519 signature over `${timestamp}\|${rawBody}` |
| `telnyx-timestamp` | yes | Unix timestamp used in the signed payload |
| `content-type` | yes | `application/json` |

### Request body

Raw Telnyx Verify event. Fields consumed:

| Field | Type | Required | Description |
|---|---|---|---|
| `data.event_type` | string | no | e.g. `verify.sent`, `verify.delivered`, `verify.failed`. Defaults to `"unknown"` |
| `data.payload.verification_id` | string | no | Compared against the actor's `verify_id`; a mismatch is recorded as `ignored` |
| `data.payload.status` | string | no | `accepted` / `failed` — recorded as the audit `result` |
| `data.payload.failed_attempts` | number | no | Recorded in the audit `detail` |

### Example request

```bash
BODY='{"data":{"event_type":"verify.failed","payload":{"verification_id":"demo-verify-m1x9zq","status":"failed","failed_attempts":1}}}'
TS=$(date +%s)
SIG=$(printf '%s|%s' "$TS" "$BODY" | openssl pkeyutl -sign -inkey ed25519.pem | base64 -w0)

curl -s -X POST "http://localhost:8787/webhooks/verify?action_id=action-4471" \
  -H 'content-type: application/json' \
  -H "telnyx-timestamp: $TS" \
  -H "telnyx-signature-ed25519: $SIG" \
  --data-raw "$BODY"
```

### Response — 200

```json
{
  "received": true,
  "result": { "ok": true, "applied": true }
}
```

| Field | Type | Description |
|---|---|---|
| `received` | boolean | Always `true` on an accepted webhook |
| `result.ok` | boolean | Actor accepted the event |
| `result.applied` | boolean | `false` when `verification_id` did not match the session (recorded as `ignored`) |

### Status codes

| Code | Meaning |
|---|---|
| 200 | Signature valid, event folded into the trail |
| 400 | `invalid_json` or `missing_action_id` |
| 401 | `invalid_signature` — missing headers or failed Ed25519 verification |
| 405 | Method other than `POST` |
| 503 | `webhook_verification_not_configured` — `TELNYX_PUBLIC_KEY` secret absent |
| 500 | `internal_error` |

### Ordering note

`verification.complete` may arrive before the `/submit` check response is processed. The webhook is appended to the trail as a corroborating entry; the check response remains the authority for `committed` / `rejected`.

---

## Route summary

| Method | Path | Body | Success shape |
|---|---|---|---|
| `POST` | `/actions/:id/verify-profile` | — | `{ ok, created, verify_profile_id }` |
| `POST` | `/actions/:id/start` | `phone_number?`, `action_kind?`, `destination?` | `{ ok, status, verify_id, expires_at, attempts_left }` |
| `POST` | `/actions/:id/submit` | `code` | `{ ok, status, destination?, committed_at?, attempts_left?, locked_until?, message? }` |
| `GET` | `/actions/:id/audit` | — | `{ action_kind, status, phone_number, attempts_left, expires_at, locked_until, audit[] }` |
| `POST` | `/webhooks/verify?action_id=` | Telnyx Verify event | `{ received, result }` |

---

## Upstream Telnyx calls

Issued by the actor via raw `fetch` to `https://api.telnyx.com/v2` with `Authorization: Bearer <TELNYX_API_KEY>` from `env.SECRETS`. Skipped entirely when `DEMO_MODE=true`.

| Call | Trigger | Handled failures |
|---|---|---|
| `POST /verify_profiles` | `/verify-profile` | Non-2xx → `{ ok: false, status: "api_error" }` |
| `POST /verifications/sms` | `/start` | `429` → `rate_limited` with `retry_after_secs` from the `Retry-After` header (default 60); other non-2xx → `api_error` |
| `POST /verifications/check/{verification_id}` | `/submit` | `404` → `not_found` (surfaced as `expired`); other non-2xx → `error` (no attempt consumed); `data.response_code` `accepted` \| anything-else → `rejected` |

Expiry is **not** an HTTP status: an expired verification's check returns `rejected`, and the actor's own `expires_at` clock short-circuits the call so the user gets a clean `expired` answer without a round trip.

---

## Environment variables affecting the contract

| Variable | Default | Effect on responses |
|---|---|---|
| `DEMO_MODE` | `true` | `true` stubs Verify trigger/check and suppresses all SMS. Only `123456` is accepted. |
| `DEMO_PHONE` | — | Fallback `phone_number` for `/start` when the body omits it |
| `VERIFY_PROFILE_ID` | — | Pre-empts profile creation; `/verify-profile` returns `created: false` |
| `PUBLIC_BASE_URL` | — | Base for the profile's `webhook_url`; omitted when unset |
| `DISPATCH_FROM_NUMBER` | — | Sender for commit/lockout SMS notifications (live mode only) |
| `TELNYX_API_KEY` | — | Secret; required for any live Verify call |
| `TELNYX_PUBLIC_KEY` | — | Secret; required for `/webhooks/verify` signature verification |
