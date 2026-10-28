# API Reference — Per-Caller Intake Concierge

Typed reference for the edge function's HTTP endpoints and the `IntakeDossier` agent methods. The deployed function URL looks like `per-caller-intake-<id>.telnyxcompute.com`.

---

## POST /webhook/initialization

Called by Telnyx AI Assistants at conversation start when the assistant has `dynamic_variables_webhook_url` set. The delivery is an `assistant.initialization` event, Ed25519-signed by Telnyx; the handler verifies the signature before trusting the body (missing secret → 500, fail closed; bad signature → 401; stale timestamp beyond a 5-minute replay window → 401).

### Request

**Headers**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Content-Type` | string | yes | `application/json` |
| `telnyx-timestamp` | string | yes | Unix seconds, within the 5-minute replay window |
| `telnyx-signature-ed25519` | string | yes | Ed25519 signature over `{timestamp}|{raw_body}`, base64/base64url |

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | string | yes | Must be `assistant.initialization` |
| `data.payload.telnyx_end_user_target` | string | yes | E.164 phone number of the returning patient (e.g. `+15551234567`) |
| `data.payload.telnyx_end_user_target_verified` | boolean | no | `true` when the call carried Full (A) STIR/SHAKEN attestation |
| `data.payload.call_control_id` | string | no | Live-call identifier (voice channel) |
| `data.payload.assistant_id` | string | no | The assistant handling the conversation |

### Example Request

```bash
curl -X POST https://<your-edge-url>/webhook/initialization \
  -H "Content-Type: application/json" \
  -H "telnyx-timestamp: 1761859200" \
  -H "telnyx-signature-ed25519: <base64url-signature>" \
  -d '{
    "data": {
      "record_type": "event",
      "event_type": "assistant.initialization",
      "occurred_at": "2025-10-30T16:00:00Z",
      "payload": {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_agent_target": "+13128675309",
        "telnyx_end_user_target": "+15551234567",
        "telnyx_end_user_target_verified": false,
        "call_control_id": "v3:u5OAKGEPT3Dx8SZSSDRWEMdNH2OripQhO",
        "assistant_id": "assistant_12345678-90ab-cdef-1234-567890abcdef"
      }
    }
  }'
```

### Response

**200 OK** — Dynamic variables + encrypted per-caller credential

| Field | Type | Description |
|-------|------|-------------|
| `dynamic_variables` | object | Plain-text variables consumed by the assistant greeting |
| `dynamic_variables.patient_name` | string | Patient name (e.g. `"Sarah"`) |
| `dynamic_variables.provider` | string | Assigned provider (e.g. `"Dr. Lee"`) |
| `dynamic_variables.last_visit` | string | Last visit date within the lookback window, or `"none"` |
| `dynamic_variables.balance_due` | string | Account balance (e.g. `"$0.00"`) |
| `encrypted_dynamic_variables` | object | Encrypted per-caller credential |
| `encrypted_dynamic_variables.portal_token` | string | `base64url( nonce(12 bytes) || AES-256-GCM ciphertext+tag )` — the assistant resolves it as `{{portal_token | portal_enc_key}}`; the plaintext is never in the payload |

```json
{
  "dynamic_variables": {
    "patient_name": "Sarah",
    "provider": "Dr. Lee",
    "last_visit": "Jun 12, 2026",
    "balance_due": "$0.00"
  },
  "encrypted_dynamic_variables": {
    "portal_token": "AXN2aWV3X3Rva2VuX2NpcGhlcnRleHQ..."
  }
}
```

> Respond within the assistant's `dynamic_variables_webhook_timeout_ms` (set to 8,000 ms in the GUIDE) or the call proceeds with the assistant's default variables.

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Success — variables returned |
| `400` | Bad request — not an `assistant.initialization` event, or missing/invalid `telnyx_end_user_target` |
| `401` | Invalid signature — tampered body, wrong key, missing headers, or stale timestamp |
| `500` | Server not configured (`TELNYX_PUBLIC_KEY` unset) or internal error |

---

## POST /webhook/post-conversation

Called by the assistant's post-conversation wrap-up turn to file the visit summary into the durable dossier. The handler verifies the `Authorization` bearer token against the `DOSSIER_WEBHOOK_AUTH` edge secret (**fails closed** — a missing secret yields 500, never unauthenticated acceptance), resolves the caller's agent, and invokes `fileVisitSummary`.

### Request

**Headers**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Content-Type` | string | yes | `application/json` |
| `Authorization` | string | yes | `Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}` — configured on the assistant's tool |

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `telnyx_end_user_target` | string | yes | E.164 phone number of the patient |
| `visit_reason` | string | yes | Reason for the visit (e.g. `"follow-up"`) |
| `follow_up` | string | no | Assistant-generated summary of the conversation |
| `next_step` | string | yes | Next action (e.g. `"rescheduled to Thursday"`) |

### Example Request

```bash
curl -X POST https://<your-edge-url>/webhook/post-conversation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <dossier_webhook_auth_token>" \
  -d '{
    "telnyx_end_user_target": "+15551234567",
    "visit_reason": "follow-up",
    "follow_up": "Patient reports improved hearing. Discussed hearing aid maintenance.",
    "next_step": "rescheduled to Thursday"
  }'
```

### Response

**200 OK** — Filing result

| Field | Type | Description |
|-------|------|-------------|
| `filed` | boolean | `true` if a new visit row was inserted; `false` if deduped (already filed) |
| `visit_id` | number \| null | SQL row id of the visit record |

```json
{
  "filed": true,
  "visit_id": 42
}
```

> **Restart proof**: the wrap-up turn's webhook tool is retried by the platform on failure. Filing dedupes by `(visit_reason, next_step)`, so retries never create duplicate rows — a retry returns `{filed: false, visit_id: <original>}`.

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Success — visit filed (or deduped) |
| `400` | Bad request — missing/invalid `telnyx_end_user_target`, or missing `visit_reason`/`next_step` |
| `401` | Unauthorized — missing or invalid `Authorization` header |
| `500` | Server not configured (`DOSSIER_WEBHOOK_AUTH` unset) or internal error |

---

## GET /dossier/{phone_digits}

Dev dashboard: the full dossier for one caller. `phone_digits` is the E.164 number without the leading `+` (e.g. `15551234567`).

### Example Request

```bash
curl https://<your-edge-url>/dossier/15551234567
```

### Response

**200 OK**

```json
{
  "patient_name": "Sarah",
  "provider": "Dr. Lee",
  "balance_due": "$0.00",
  "last_visit": "2026-10-06T14:22:31.000Z",
  "visits": [
    {
      "id": 2,
      "at": "2026-10-06T14:22:31.000Z",
      "reason": "hearing check",
      "summary": "Audiogram scheduled after improvement reported.",
      "next_step": "audiogram on Friday"
    },
    {
      "id": 1,
      "at": "2026-10-02T18:05:12.000Z",
      "reason": "ear pain",
      "summary": "Possible infection; drops prescribed.",
      "next_step": "follow-up in two weeks"
    }
  ],
  "lastVisitAt": "2026-10-06T14:22:31.000Z"
}
```

Token plaintexts are never stored, so they cannot appear in this view.

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Dossier returned |
| `404` | Unknown path |

---

## GET /health

### Example Request

```bash
curl https://<your-edge-url>/health
```

### Response

**200 OK**

```json
{
  "status": "ok"
}
```

---

## Agent RPC Methods

The `IntakeDossier` agent exposes the following methods (callable via the actor stub, not directly over HTTP). One instance per caller is addressed with `env.DOSSIERS.idFromName(phoneDigits)`.

### `handleInitialization(lookbackDays)`

Invoked by the initialization webhook handler. Reads the durable dossier from embedded SQL and returns the personalized variables plus a fresh one-time credential.

| Parameter | Type | Description |
|-----------|------|-------------|
| `lookbackDays` | number | Visit-history lookback window (from `VISIT_LOOKBACK_DAYS`) |

**Returns:** `DynamicVarsResponse` — `{dynamic_variables, encrypted_dynamic_variables}` (shape above).

### `fileVisitSummary(args)`

Invoked by the post-conversation webhook handler. Idempotent — dedupes by `(visit_reason, next_step)`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | object | `{visit_reason, follow_up, next_step}` |

**Returns:** `{filed: boolean, visit_id: number | null}`

### `dossierView()`

Dev inspection. Returns identity, provider, last visit, the visit history, and durable state.

**Returns:** `{patient_name, provider, balance_due, last_visit, visits, lastVisitAt}`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | yes | Telnyx API key — setup/provisioning steps (not read by the function code) |
| `TELNYX_PUBLIC_KEY` | yes | Ed25519 public key for webhook signature verification (edge secret) |
| `PORTAL_ENC_KEY` | yes | Base64url 32-byte AES-256 key; must equal the `portal_enc_key` integration secret's token (edge secret) |
| `DOSSIER_WEBHOOK_AUTH` | yes | Bearer token for the filing tool; must equal the `dossier_webhook_auth` integration secret's token (edge secret) |
| `VISIT_LOOKBACK_DAYS` | no | Visit-history lookback window in days (default `365`) |
| `PORTAL_BASE_URL` | no | Patient portal base URL for the demo credential flow |

---

## Failure Behavior Summary

| Failure | Behavior |
|---------|----------|
| Missing/unset `TELNYX_PUBLIC_KEY` | Initialization handler returns 500 — fail closed, unverified bodies never accepted |
| Tampered/stale/wrongly-signed initialization | 401 — Telnyx proceeds with assistant default variables |
| Missing/unset `DOSSIER_WEBHOOK_AUTH` | Post-conversation handler returns 500 — fail closed, no unauthenticated filing |
| Credential decryption failure at tool time | Tool call fails closed per the docs (MCP server excluded; credentials never sent unauthenticated) — no fallback |
| Webhook-tool retry after a kill | Idempotent filing — `{filed: false, visit_id: <original>}`, no duplicate rows |
