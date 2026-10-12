# Per-Caller Intake Concierge — Developer Guide

A step-by-step walkthrough of the `per-caller-intake` sample: a durable, per-caller Agent-SDK dossier that greets returning patients by name, hands off an encrypted one-time portal credential, and files visit summaries after every call — so visit #3 knows what visit #2 said, forever.

---

## Prerequisites

- A Telnyx account with **AI Assistants** and **Edge Compute** enabled.
- The `telnyx-edge` CLI installed and authenticated:
  ```bash
  telnyx-edge auth api-key set <your_api_key>
  ```
- Node.js 20+ (for local type-checking and the smoke test).
- A phone number routed to the assistant (for the live demo) — buy one in the [Portal](https://portal.telnyx.com/numbers) or via `telnyx number-orders create --profile international --quantity 1`.

---

## Step 1: Generate and register the credential key

The assistant references `{{portal_token | portal_enc_key}}` — a 32-byte AES-256 key. One key value lives in two places:

1. As the **edge secret** `PORTAL_ENC_KEY` — the webhook encrypts the per-caller token with it.
2. As the **integration secret** `portal_enc_key` — Telnyx decrypts with it at the moment of tool use.

```bash
# Generate a 32-byte key, base64url-encoded
KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')

# Edge secret — the webhook encrypts with this
telnyx-edge secrets add PORTAL_ENC_KEY "$KEY"

# Integration secret — the assistant references it as {{portal_token | portal_enc_key}}
curl -X POST https://api.telnyx.com/v2/integration_secrets \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"portal_enc_key\", \"type\": \"bearer\", \"token\": \"$KEY\"}"
```

> The Integration Secrets API never returns the token value, so the edge function keeps its own copy. The two must stay in sync — rotate them together.

### Credential-failure path

If `PORTAL_ENC_KEY` is unset on the edge function, the initialization handler returns a 500 and Telnyx proceeds with the assistant's default variables — and because no encrypted variable was delivered, any tool that references `{{portal_token | portal_enc_key}}` fails **closed** (per the docs): the MCP server is excluded from the conversation and webhook-tool credential positions are never sent unauthenticated.

---

## Step 2: Store the Ed25519 public key

Telnyx signs the `assistant.initialization` webhook with Ed25519 over `"{timestamp}|{body}"`. Fetch the account's public key and store it as a secret:

```bash
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
```

The handler verifies the signature on every initialization delivery and rejects tampered bodies, stale timestamps (5-minute replay window), and wrong-key signatures. A missing `TELNYX_PUBLIC_KEY` fails closed — the handler returns 500 rather than accepting an unverified body.

---

## Step 3: Create the filing-tool auth token

The post-conversation filing tool authenticates with a bearer token:

```bash
TOKEN=$(openssl rand -hex 24)

telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$TOKEN"

# The assistant's tool sends it via the integration-secret mustache
curl -X POST https://api.telnyx.com/v2/integration_secrets \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"dossier_webhook_auth\", \"type\": \"bearer\", \"token\": \"$TOKEN\"}"
```

If `DOSSIER_WEBHOOK_AUTH` is unset on the edge function, the post-conversation handler returns 500 — fail closed, never accept unauthenticated filings.

---

## Step 4: Understand `telnyx.toml`

The project's `telnyx.toml` declares the agent binding and secrets:

```toml
name = "per-caller-intake"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "DOSSIERS"
type    = "IntakeDossier"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

[[secrets]]
binding = "PORTAL_ENC_KEY"
name    = "PORTAL_ENC_KEY"

[[secrets]]
binding = "DOSSIER_WEBHOOK_AUTH"
name    = "DOSSIER_WEBHOOK_AUTH"

[env_vars]
VISIT_LOOKBACK_DAYS = "365"
PORTAL_BASE_URL     = "https://portal.demo.example"
```

No SQL binding is declared — every `Agent` carries a **private embedded SQLite database** at `this.ctx.storage.sql`, created on first use, private to that one agent instance. Regenerate the typed bindings after editing:

```bash
telnyx-edge types
```

---

## Step 5: Deploy

```bash
npm install
telnyx-edge ship
```

`ship` prints a URL like `per-caller-intake-<id>.telnyxcompute.com`.

---

## Step 6: Configure the assistant

Create (or update) the AI Assistant. Point `dynamic_variables_webhook_url` and the filing tool's URL at the deployed function:

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "name": "ent-clinic-intake-concierge",
  "model": "moonshotai/Kimi-K2.6",
  "greeting": "Hello {{patient_name}} — this is the ENT clinic. Dr. {{provider}} is expecting you.",
  "instructions": "you are the intake concierge for an ear, nose, and throat clinic. personalize every conversation using your dynamic variables: the patient is {{patient_name}}, their provider is {{provider}}, their last visit was {{last_visit}}, and their balance due is {{balance_due}}. greet the patient by name and reference their history naturally. if last_visit is none, this is their first visit — do not invent history. keep your turns short and warm.\n\nthe caller's phone number is {{telnyx_end_user_target}}.\n\nwhen the patient's need has been handled (appointment scheduled, question answered, or concern triaged), call the file_visit_summary tool exactly once with: telnyx_end_user_target set to {{telnyx_end_user_target}} (copy this exact value — it is a phone number, never write anything else in this field), visit_reason set to a one-to-three-word reason for this call (e.g. hearing check), follow_up set to a one-sentence summary of what was discussed, and next_step set to the concrete next action agreed (e.g. audiogram Friday). if the patient hangs up before you call it, that is fine — the tool will be available again.",
  "dynamic_variables_webhook_url": "https://<your-function>.telnyxcompute.com/webhook/initialization",
  "dynamic_variables_webhook_timeout_ms": 8000,
  "post_conversation_settings": { "enabled": true },
  "enabled_features": ["telephony"],
  "tools": [
    {
      "type": "webhook",
      "webhook": {
        "name": "file_visit_summary",
        "description": "after the conversation ends, file the visit summary into the patient's durable dossier. call this once with the caller's phone number, the reason for the visit, a brief follow-up summary of what was discussed, and the concrete next step (e.g. rescheduled appointment date).",
        "url": "https://<your-function>.telnyxcompute.com/webhook/post-conversation",
        "method": "POST",
        "headers": [
          {
            "name": "Authorization",
            "value": "Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}"
          }
        ],
        "body_parameters": {
          "type": "object",
          "properties": {
            "telnyx_end_user_target": { "type": "string", "description": "caller phone number in e.164 format" },
            "visit_reason": { "type": "string", "description": "reason for the visit (e.g. follow-up, hearing check)" },
            "follow_up": { "type": "string", "description": "brief summary of what was discussed and any care notes" },
            "next_step": { "type": "string", "description": "concrete next action (e.g. rescheduled to Thursday)" }
          },
          "required": ["telnyx_end_user_target", "visit_reason", "next_step"]
        }
      }
    }
  ]
}
JSON
```

Notes:

- `post_conversation_settings: {enabled: true}` gives the assistant **one** wrap-up LLM turn after the call. During that turn only **webhook tools and function tools** are available — integrations/MCP tools and call-control tools (`hangup`, `transfer`) are refused. That is why the filing is a webhook tool.
- The filing tool's `Authorization` header resolves the `dossier_webhook_auth` integration secret server-side; the token never appears in the conversation or the model context.
- `dynamic_variables_webhook_timeout_ms: 8000` leaves room for edge cold starts (default is 1,500 ms).

---

## Demo Mode vs Live Mode

| Mode | Behavior |
|---|---|
| **Demo (default)** | The actor seeds a demo identity on first boot (`patient_name: "Sarah"`, `provider: "Dr. Lee"`, `balance_due: "$0.00"`) and then serves everything from SQL. Portal tokens are real AES-256-GCM ciphertexts; `PORTAL_BASE_URL` points at a demo portal. Visit summaries are filed to the real dossier. |
| **Live** | Point `PORTAL_BASE_URL` at your patient portal and replace the `identity` seed with your EHR lookup. The credential encryption and filing pipeline are unchanged. |

---

## How It Works — Step by Step

### The actor — `IntakeDossier`

`IntakeDossier` (in `src/dossier.ts`) extends `Agent<DossierEnv, DossierState>`. One instance per caller: `env.DOSSIERS.idFromName(phoneDigits)` routes every call from the same number to the same serialized, durable instance. Its `initialState()` returns `{lastVisitAt: null, lastFiledVisitId: null}`; state and SQL writes are persisted **before** a reply is returned, so a kill between call end and filing still leaves a consistent dossier on restart.

### Initialization — personalized greeting + one-time credential

Telnyx POSTs the Ed25519-signed `assistant.initialization` event to `/webhook/initialization`. The handler verifies the signature, extracts `data.payload.telnyx_end_user_target`, and dispatches to the caller's agent instance. The agent:

1. Ensures the embedded SQL schema (`visits`, `identity`, `prefs`) exists.
2. Reads the greeting variables from SQL: `patient_name`, `provider`, `last_visit` (within `VISIT_LOOKBACK_DAYS`), `balance_due`.
3. Generates a **fresh** 32-byte random `portal_token` plaintext and encrypts it: `base64url( nonce(12 bytes) || AES-256-GCM ciphertext+tag )` with the `PORTAL_ENC_KEY` key. The plaintext is never stored, logged, or returned.

The assistant then opens with: *"Hi Sarah — Dr. Lee is expecting you for your 2:15 follow-up."*

### The credential — decrypted only at the moment of use

The assistant references the encrypted variable exactly where a credential belongs: `{{portal_token | portal_enc_key}}`. Telnyx decrypts it for this conversation only. A plain `dynamic_variables` value is never usable as a credential, and an encrypted variable is never substituted into instructions, greetings, or tool descriptions.

### Filing into the dossier — wrap-up or end-of-call

The assistant calls `file_visit_summary` when the patient's need has been handled — either during the live conversation (as observed in practice: the model files as soon as the visit is agreed) or in the post-conversation wrap-up turn (`post_conversation_settings: {enabled: true}` keeps webhook tools available after the call). Either way the flow is identical: the handler checks the bearer token (fail closed), normalizes the caller's number, and invokes `fileVisitSummary` on the caller's agent. The agent dedupes by `(visit_reason, next_step)` — so a mid-call filing followed by a wrap-up retry (or a platform webhook-tool retry) never creates duplicate rows — inserts the visit, and updates durable state.

**Number fidelity**: the model must copy the caller's number from its context, not invent it. The recommended instruction template substitutes it literally (`the caller's phone number is {{telnyx_end_user_target}}`) — in live testing this eliminated hallucinated numbers in the tool call.

**Restart proof**: kill the actor between call end and file-write and the webhook tool's retry re-fails into the idempotent path: the first attempt either committed before the kill (durable-before-reply) or never committed at all, so the retry lands exactly once. The next call greets with the filed summary.

### Two-visit demo — the dossier carried the memory

Days later the same number calls again. The same agent instance returns updated variables (`last_visit` from SQL) and a **fresh** one-time token — every conversation gets its own credential.

### Dev inspection

```bash
curl https://<your-function>.telnyxcompute.com/dossier/<phone-digits>
```

Returns the dossier view: identity, provider, last visit, the full visit history, and durable state. Token plaintexts are never stored, so they cannot appear here.

---

## Scripted Demo (no phone needed)

Replay the two visits with curl:

```bash
# Visit #1 — initialization (greets: last_visit "none")
curl -s -X POST https://<your-function>.telnyxcompute.com/webhook/initialization \
  -H "Content-Type: application/json" \
  -d '{"data":{"record_type":"event","event_type":"assistant.initialization","payload":{"telnyx_conversation_channel":"phone_call","telnyx_agent_target":"+13128675309","telnyx_end_user_target":"+15551234567","call_control_id":"v3:demo","assistant_id":"assistant_demo"}}}'

# Visit #1 — post-conversation filing
curl -s -X POST https://<your-function>.telnyxcompute.com/webhook/post-conversation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOSSIER_WEBHOOK_AUTH" \
  -d '{"telnyx_end_user_target":"+15551234567","visit_reason":"hearing check","follow_up":"First visit. Audiogram scheduled.","next_step":"audiogram booked for Friday"}'

# Visit #2 — initialization again: last_visit is now real, new token minted
curl -s -X POST https://<your-function>.telnyxcompute.com/webhook/initialization \
  -H "Content-Type: application/json" \
  -d '{...same initialization body...}'

# Inspect the dossier
curl -s https://<your-function>.telnyxcompute.com/dossier/15551234567
```

> The scripted initialization calls above are unsigned — they only work while testing without signature verification, which the deployed function enforces. For a signature-free local exercise, run the smoke test instead: it exercises the envelope parsing, signature verification (including tamper/replay/wrong-key rejection), and the crypto round trip without a live deployment.

---

## Telnyx Primitives Used

| Primitive | Where Used |
|---|---|
| **Agent SDK** (`Agent<E, State>`) | `IntakeDossier` — durable state, embedded SQL, serialized turns |
| **Stateful Actors** (`env.DOSSIERS.idFromName()`) | One durable dossier per caller phone number |
| **Agent SDK SQL** (`this.ctx.storage.sql`) | `visits`, `identity`, `prefs` — the durable record |
| **Dynamic Variables Webhook** | `assistant.initialization` → `dynamic_variables` + `encrypted_dynamic_variables` |
| **Per-Caller Credentials** | AES-256-GCM `portal_token`, referenced as `{{portal_token \| portal_enc_key}}` |
| **Post-Conversation Processing** | `post_conversation_settings.enabled` → wrap-up turn → webhook filing |
| **Integration Secrets** | `portal_enc_key` (credential decryption), `dossier_webhook_auth` (filing-tool auth) |

---

## Smoke Test

```bash
npx tsx smoke_test.ts
```

Exercises, without account access:

- The agent surface (`IntakeDossier`, `handleInitialization`, `fileVisitSummary`, `dossierView`, `initialState` shape).
- The exact `assistant.initialization` envelope parsing (`data.payload.telnyx_end_user_target`).
- Ed25519 signature verification: valid signature accepted; tampered body, stale (replayed) timestamp, missing headers, and wrong-key signatures all rejected.
- The per-caller credential crypto: base64url `nonce(12) || AES-256-GCM ciphertext+tag` format, round-trip correctness, wrong-key failure closed, and 32-byte key enforcement.

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 invalid webhook signature` on initialization | Missing/wrong `TELNYX_PUBLIC_KEY`, tampered body, or stale timestamp | Re-fetch the public key (`GET /v2/public_key`), re-run `telnyx-edge secrets add TELNYX_PUBLIC_KEY`, redeploy |
| `500 server not configured` | A required secret is unset | Handlers fail closed by design — set the missing secret and redeploy |
| Greeting shows raw `{{patient_name}}` | Webhook timed out (default 1.5 s) | `dynamic_variables_webhook_timeout_ms: 8000`; check edge function logs |
| Credential never resolves in the tool | `PORTAL_ENC_KEY` and the `portal_enc_key` integration secret diverge | Regenerate both from one `openssl rand -base64 32` value; rotate together |
| `Unauthorized` on filing | Tool header not using the integration-secret mustache | `Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}` |
| Post-conversation tool not called | `post_conversation_settings` not enabled, or the assistant's only tools are excluded post-conversation | Enable the setting; use webhook/function tools for wrap-up work |
| Duplicate visit rows | Not expected — filing dedupes by `(visit_reason, next_step)` | Confirm the assistant sends identical strings on retries |

---

## Next Steps

- [Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables) — the initialization webhook and variable resolution order.
- [Per-Caller Credentials](https://developers.telnyx.com/docs/inference/ai-assistants/per-caller-credentials) — the encrypted credential scheme and failure behavior.
- [Post-Conversation Processing](https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing) — the wrap-up turn and tool availability.
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql) — embedded per-agent storage patterns.
- [Agent SDK Scheduling](https://developers.telnyx.com/docs/agent-sdk/api-reference/agent/scheduling) — `this.schedule()`, `this.queue()`, `this.every()`.
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — per-entity durable memory.
- [Receiving Webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks) — Ed25519 verification contract.
