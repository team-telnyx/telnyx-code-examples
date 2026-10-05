```markdown
# Per-Caller Intake Concierge — Developer Guide

A step-by-step walkthrough of the `per-caller-intake` sample: a durable, per-caller AI assistant that greets returning patients by name, hands off an encrypted one-time portal credential, and files visit summaries into a durable SQL dossier after every call.

---

## Prerequisites

- A Telnyx account with **AI Assistants** and **Edge Compute** enabled.
- The `telnyx-edge` CLI installed and authenticated:
  ```bash
  telnyx-edge auth api-key set <your_api_key>
  ```
- Node.js 18+ (for local type-checking and smoke test).
- The `@telnyx/edge-runtime` package (declared in `package.json`).

---

## Environment Setup

### 1. Create the integration secret for portal token encryption

The assistant references `{{portal_token | portal_enc_key}}` — a 32-byte AES-GCM key stored as an integration secret. Generate one and register it:

```bash
# Generate a 32-byte key, base64url-encoded
KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')

# Register as an integration secret
telnyx-edge secrets add PORTAL_ENC_KEY_REF "$KEY"
```

### 2. Create the webhook auth secret

The post-conversation webhook verifies a bearer token:

```bash
telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$(openssl rand -hex 32)"
```

### 3. Configure `telnyx.toml`

The project's `telnyx.toml` declares the actor binding, secrets, and SQL database:

```toml
name = "per-caller-intake"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "DOSSIERS"
type    = "IntakeDossier"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "PORTAL_ENC_KEY_REF"
name    = "PORTAL_ENC_KEY_REF"

[[secrets]]
binding = "DOSSIER_WEBHOOK_AUTH"
name    = "DOSSIER_WEBHOOK_AUTH"

[storage.sqldb.DOSSIER_DB]
id = "<sql-database-uuid>"

[env_vars]
VISIT_LOOKBACK_DAYS = "365"
FILE_RETRY_MAX      = "3"
PORTAL_BASE_URL     = "https://portal.demo.health"
```

### 4. Regenerate type bindings

```bash
telnyx-edge types
```

This generates `telnyx-env.d.ts` from your `telnyx.toml` bindings.

### 5. Deploy

```bash
telnyx-edge ship
```

---

## Demo Mode vs Live Mode

| Mode | Behavior |
|---|---|
| **Demo (default)** | No real SMS or calls are placed. The assistant greets with hardcoded demo data (`patient_name: "Sarah"`, `provider: "Dr. Lee"`). Portal tokens are real AES-GCM encrypted but point to a demo portal URL. Visit summaries are filed to the real SQL dossier. |
| **Live** | Set `PORTAL_BASE_URL` to your production patient portal. Replace demo patient data with a real identity lookup from your EHR. The credential encryption and filing pipeline remain identical. |

To switch to live mode, update `PORTAL_BASE_URL` in your `telnyx.toml` `[env_vars]` section and redeploy.

---

## How It Works — Step by Step

### Step 1: The Actor — `IntakeDossier`

The `IntakeDossier` class (in `src/index.ts`) extends `Agent<Env, State>`. It is a **Stateful Actor** — one instance is born per caller phone number, identified by `env.DOSSIERS.idFromName(phoneDigits)`.

Key state fields:
- `alertedFile` — whether the post-conversation filing has been attempted.
- `lastVisitAt` — timestamp of the most recently filed visit.
- `fileRetryCount` — retry counter for idempotent filing.

The actor's `initialState()` method returns the default state. State is persisted across restarts via the Agent SDK's durable state mechanism.

### Step 2: Initialization Webhook — Personalized Greeting

When a patient calls the clinic line, Telnyx AI Assistants fires the `dynamic_variables_webhook_url` with an `assistant.initialization` event. The webhook handler (`handleInitializationWebhook`) extracts the caller's phone digits from `payload.telnyx_end_user_target`, then dispatches to the correct actor instance via `env.DOSSIERS.idFromName(phoneDigits)`.

The actor's `handleInitialization` method:
1. Ensures the SQL schema exists (`ensureSchema`).
2. Builds `dynamic_variables` — plain-text variables the assistant can reference in its greeting: `patient_name`, `provider`, `last_visit`, `balance_due`. These are pulled from the SQL `prefs` and `visits` tables.
3. Builds `encrypted_dynamic_variables` — a fresh one-time `portal_token`, AES-GCM encrypted with the integration secret key. The plaintext token **never** appears in the webhook response payload.

The assistant then opens with: *"Hi Sarah — Dr. Lee is expecting you for your 2:15 follow-up."*

### Step 3: Per-Caller Credentials — Encrypted Portal Token

The `buildEncryptedVariables` method generates a 32-byte random portal token, then encrypts it using AES-GCM with a 12-byte random IV. The key is retrieved from the `PORTAL_ENC_KEY_REF` integration secret via `this.env.PORTAL_ENC_KEY_REF.get("token")`.

The encrypted blob (IV + ciphertext, base64-encoded) is returned as `encrypted_dynamic_variables.portal_token`. The assistant references it in tool calls as `{{portal_token | portal_enc_key}}` — Telnyx decrypts it at the moment of use, inside the assistant's MCP/tool call, and **never** exposes the plaintext to the model context or logs.

**Credential-failure path**: If `PORTAL_ENC_KEY_REF` is not configured, the method throws. The assistant's tool call fails closed — no unauthenticated fallback occurs.

### Step 4: Post-Conversation Filing — Durable Dossier

After the call ends, the assistant's `post_conversation_settings` runs one wrap-up LLM turn. During this turn, a webhook tool (`handlePostConversationWebhook`) POSTs `{visit_reason, follow_up, next_step}` to the actor.

The actor's `fileVisitSummary` method:
1. Verifies the bearer token against `DOSSIER_WEBHOOK_AUTH`.
2. Checks for an existing visit row with the same `(phone_digits, reason, next_step)` — **idempotency** prevents duplicate rows on retry.
3. Inserts the visit into the SQL `visits` table.
4. Updates durable state (`lastVisitAt`, `alertedFile`, `fileRetryCount`).

**Restart proof**: If the actor is killed between call end and file-write, the webhook tool retries. The idempotency check ensures no duplicate rows. The next call still greets with the filed summary.

### Step 5: Two-Visit Demo — The Dossier Remembers

Two days later, the same number calls again. The actor (still alive in durable storage) returns **new** dynamic variables (updated `last_visit`, new `provider` if changed) and a **fresh** one-time portal token. The dossier — not the conversation — carried the memory.

### Step 6: Dev Inspection — `dossierView` RPC

The `dossierView` RPC method lets developers inspect the dossier state and visit history for debugging:

```bash
telnyx-edge actors rpc DOSSIERS <actor-id> dossierView
```

---

## Telnyx Primitives Used

| Primitive | Where Used |
|---|---|
| **Agent SDK** (`Agent<Env, State>`) | `IntakeDossier` class — durable state, SQL, scheduling |
| **Stateful Actors** (`env.DOSSIERS.idFromName()`) | One actor per caller phone number |
| **SQL Storage** (`SqlDatabase`) | `visits` and `prefs` tables — durable visit history |
| **Dynamic Variables Webhook** | `assistant.initialization` → `dynamic_variables` + `encrypted_dynamic_variables` |
| **Per-Caller Credentials** | AES-GCM encrypted `portal_token` via integration secret |
| **Post-Conversation Processing** | `post_conversation_settings.enabled` → wrap-up LLM turn → webhook filing |
| **Integration Secrets** | `PORTAL_ENC_KEY_REF`, `DOSSIER_WEBHOOK_AUTH` |

---

## Smoke Test

Verify the module loads and the class/methods exist:

```bash
npx tsx smoke_test.ts
```

The smoke test imports `IntakeDossier` from `src/index.ts` and asserts:
- The class extends `Agent`.
- `handleInitialization`, `fileVisitSummary`, and `dossierView` methods exist.
- The default `fetch` handler responds to `/health`.

---

## Next Steps

- [Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables) — customize greetings per caller.
- [Per-Caller Credentials](https://developers.telnyx.com/docs/inference/ai-assistants/per-caller-credentials) — secure credential handoff with `encrypted_dynamic_variables`.
- [Post-Conversation Processing](https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing) — wrap-up turns and filing.
- [AI Assistants Memory Documentation](https://developers.telnyx.com/docs/inference/ai-assistants/memory)
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql) — durable storage patterns.
- [Agent SDK Scheduling](https://developers.telnyx.com/docs/agent-sdk/api-reference/agent/scheduling) — `this.schedule()`, `this.queue()`, `this.every()`.
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — per-caller durable memory.
```
