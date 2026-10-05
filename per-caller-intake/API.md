```markdown
# API Reference — Per-Caller Intake Concierge

Typed endpoint reference for the `per-caller-intake` sample. All routes are served from the Telnyx Edge runtime (`src/index.ts`).

---

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/initialization` | Assistant initialization webhook — returns dynamic variables + encrypted portal token |
| `POST` | `/webhook/post-conversation` | Post-conversation wrap-up webhook — files visit summary into the durable dossier |
| `GET` | `/health` | Health check |

---

## POST /webhook/initialization

Called by Telnyx AI Assistants on `assistant.initialization`. The request body is the signed webhook payload delivered by Telnyx. The handler extracts the caller's phone number from `telnyx_end_user_target`, resolves the per-caller `IntakeDossier` actor via `env.DOSSIERS.idFromName(...)`, and invokes `handleInitialization` on the actor stub.

### Request

**Headers**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Content-Type` | string | yes | `application/json` |
| `User-Agent` | string | no | Telnyx webhook sender |

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `telnyx_end_user_target` | string | yes | E.164 phone number of the returning patient (e.g. `+15551234567`) |
| `event` | string | no | Telnyx event type — expected `assistant.initialization` |
| `data` | object | no | Additional Telnyx webhook envelope fields |

### Example Request

```bash
curl -X POST https://<your-edge-url>/webhook/initialization \
  -H "Content-Type: application/json" \
  -d '{
    "event": "assistant.initialization",
    "telnyx_end_user_target": "+15551234567",
    "data": {
      "payload": {
        "assistant_id": "asst_abc123",
        "conversation_id": "conv_def456"
      }
    }
  }'
```

### Response

**200 OK** — Dynamic variables + encrypted portal token

| Field | Type | Description |
|-------|------|-------------|
| `dynamic_variables` | object | Plain-text variables consumed by the assistant greeting |
| `dynamic_variables.patient_name` | string | Patient name (e.g. `"Sarah"`) |
| `dynamic_variables.provider` | string | Assigned provider (e.g. `"Dr. Lee"`) |
| `dynamic_variables.last_visit` | string | Last visit date or `"none"` |
| `dynamic_variables.balance_due` | string | Account balance (e.g. `"$0.00"`) |
| `encrypted_dynamic_variables` | object | AES-GCM encrypted one-time portal token |
| `encrypted_dynamic_variables.portal_token` | string | Base64url-encoded IV + ciphertext (plaintext never in payload) |

```json
{
  "dynamic_variables": {
    "patient_name": "Sarah",
    "provider": "Dr. Lee",
    "last_visit": "Jun 12, 2025",
    "balance_due": "$0.00"
  },
  "encrypted_dynamic_variables": {
    "portal_token": "AXN2aWV3X3Rva2VuX2NpcGhlcnRleHQ..."
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Success — variables returned |
| `400` | Bad request — missing or invalid `telnyx_end_user_target` |
| `500` | Internal server error |

---

## POST /webhook/post-conversation

Called by the assistant's post-conversation wrap-up turn to file the visit summary into the durable dossier. The handler verifies the `Authorization` bearer token against the `DOSSIER_WEBHOOK_AUTH` integration secret, resolves the actor, and invokes `fileVisitSummary`.

### Request

**Headers**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Content-Type` | string | yes | `application/json` |
| `Authorization` | string | yes | `Bearer <DOSSIER_WEBHOOK_AUTH token>` |

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `telnyx_end_user_target` | string | yes | E.164 phone number of the patient |
| `visit_reason` | string | yes | Reason for the visit (e.g. `"follow-up"`) |
| `follow_up` | string | yes | Assistant-generated summary of the conversation |
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

**200 OK** — File result

| Field | Type | Description |
|-------|------|-------------|
| `filed` | boolean | `true` if a new visit row was inserted; `false` if deduped (already filed) |
| `visit_id` | number | SQL row id of the visit record |

```json
{
  "filed": true,
  "visit_id": 42
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Success — visit filed (or deduped) |
| `400` | Bad request — missing or invalid `telnyx_end_user_target` |
| `401` | Unauthorized — missing or invalid `Authorization` header |
| `500` | Internal server error |

---

## GET /health

Simple health check endpoint.

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

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Service is healthy |

---

## Actor RPC Methods

The `IntakeDossier` actor exposes the following RPC methods (callable via the actor stub, not directly over HTTP):

### `handleInitialization(payload)`

Invoked by the initialization webhook handler. Returns `DynamicVarsResponse`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `payload` | object | Webhook body containing `telnyx_end_user_target` |

### `fileVisitSummary(args)`

Invoked by the post-conversation webhook handler. Idempotent — dedupes by `(phone_digits, reason, next_step)`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | object | `{ telnyx_end_user_target, visit_reason, follow_up, next_step }` |

**Returns:** `{ filed: boolean, visit_id?: number }`

### `dossierView()`

RPC method for dev inspection. Returns the full visit history and actor state.

**Returns:** `{ visits: VisitRow[], state: DossierState }`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | yes | Telnyx API key (integration secret) |
| `PORTAL_ENC_KEY_REF` | yes | Integration secret identifier for the AES-256 portal encryption key |
| `DOSSIER_WEBHOOK_AUTH` | yes | Integration secret for authenticating post-conversation webhook calls |
| `VISIT_LOOKBACK_DAYS` | no | Days to look back for visit history (default: `365`) |
| `FILE_RETRY_MAX` | no | Max retry attempts for visit filing (default: `3`) |
| `PORTAL_BASE_URL` | no | Base URL for the patient portal (demo use) |
```
