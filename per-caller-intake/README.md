---
name: per-caller-intake
title: "Per-Caller Intake Concierge"
description: "A durable per-caller Agent-SDK dossier that greets returning patients with personalized dynamic variables, hands off an encrypted one-time portal credential, and files post-conversation visit summaries — so every call remembers the last one."
language: typescript
framework: telnyx-edge (Agent SDK)
telnyx_products: [AI Assistants, Dynamic Variables, Per-Caller Credentials, Post-Conversation Processing, Stateful Actors, Agent SDK SQL]
---

# Per-Caller Intake Concierge

A durable per-caller Agent-SDK dossier that greets returning patients with personalized dynamic variables, hands off an encrypted one-time portal credential, and files post-conversation visit summaries — so every call remembers the last one.

## The Story

An ear, nose, and throat clinic's assistant greets every caller by who they are — Sarah hears "Dr. Lee is expecting you for your 2:15 follow-up," not a generic menu. If the system forgets her last visit, her balance, or her provider, she repeats her story every time, eroding trust and risking missed care. The actor IS the returning patient's intake dossier. Born the moment Sarah's phone number hits the initialization webhook, it reads her visit history from its private embedded SQL database, returns personalized variables plus an encrypted one-time portal token, and survives every platform reboot between calls. When the conversation ends, a post-conversation webhook tool files the assistant's structured summary into the durable dossier — so visit #3 knows what visit #2 said, forever.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that makes per-caller personalization durable, secure, and auditable — combining AI Assistants with dynamic variables, per-caller encrypted credentials, post-conversation processing, and stateful actors backed by per-instance SQL storage.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|----------|---------|---------|
| `POST /v2/ai/assistants` | AI Assistants | Create/update the assistant with `dynamic_variables_webhook_url`, `post_conversation_settings`, and the filing webhook tool |
| `GET /v2/public_key` | Webhooks | Fetch the account's Ed25519 public key for webhook signature verification |
| `POST /integration_secrets` | AI Assistants | Register `portal_enc_key` (AES-256 key Telnyx uses to decrypt the per-caller credential) and `dossier_webhook_auth` (bearer token for the filing tool) |
| `POST {dynamic_variables_webhook_url}` | AI Assistants (inbound) | Receives the signed `assistant.initialization` event; returns `dynamic_variables` + `encrypted_dynamic_variables` |
| Post-conversation webhook tool | AI Assistants (inbound) | The wrap-up turn files `{visit_reason, follow_up, next_step}` into the dossier |
| `env.DOSSIERS.idFromName(phoneDigits)` | Agent SDK / Stateful Actors | One durable dossier agent per caller phone number |
| `this.ctx.storage.sql` | Agent SDK / SQL Storage | Per-instance embedded SQLite: `visits`, `identity`, `prefs` |

## Architecture

```
Patient phone ──AI Assistant──> dynamic_variables_webhook_url
                                      │
                                      ▼
                         /webhook/initialization
                         (Ed25519 signature verified)
                                      │
                                      ▼
              IntakeDossier agent — env.DOSSIERS.idFromName(phoneDigits)
              one durable instance per caller, serialized turns
              ├── Embedded SQL: visits, identity, prefs (survives restarts)
              ├── Durable state: lastVisitAt, lastFiledVisitId
              ├── Returns: dynamic_variables (patient_name, provider,
              │            last_visit, balance_due — read from SQL)
              └── Returns: encrypted_dynamic_variables {portal_token}
                  base64url( nonce(12) || AES-256-GCM ciphertext+tag )
                                      │
                                      ▼
        Assistant greets: "Hi Sarah — Dr. Lee is expecting you..."
        Tool credential resolves {{portal_token | portal_enc_key}} —
        decrypted for this conversation only, never logged, never
        shown to the model
                                      │
                                      ▼
        Conversation ends → post_conversation_settings {enabled: true}
        ONE wrap-up LLM turn (webhook/function tools only — integrations,
        MCP, and call-control tools are unavailable post-conversation)
                                      │
                                      ▼
                         /webhook/post-conversation
                         (Authorization bearer token verified)
                                      │
                                      ▼
              IntakeDossier.fileVisitSummary()
              ├── Idempotent insert — dedupes webhook-tool retries
              └── Commits visit row + durable state before replying
                                      │
                                      ▼
        Next call → same actor → fresh token + last visit's summary
```

The dynamic variables webhook is per-conversation personalization; the agent is durable memory. A plain function could answer the webhook once but could not hold the visit history, dedupe retries, or keep the credential flow auditable across restarts.

## Environment Variables / Secrets

Secrets are set via the Edge CLI (`[[secrets]]` in `telnyx.toml` declares the bindings):

```bash
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
telnyx-edge secrets add PORTAL_ENC_KEY "$KEY"
telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$TOKEN"
```

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API v2 key — used in setup/provisioning steps | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `MCowBQYDK2Vw...` | **yes** | Ed25519 public key for webhook signature verification (secret) | `GET /v2/public_key` |
| `PORTAL_ENC_KEY` | `string` | `q1zqGJeXi0...` (base64url, 32 bytes) | **yes** | AES-256 key for the per-caller credential — **same value** registered as the `portal_enc_key` integration secret | Generated — see Setup |
| `DOSSIER_WEBHOOK_AUTH` | `string` | `your_webhook_auth_token_here` | **yes** | Bearer token the filing tool sends — **same value** registered as the `dossier_webhook_auth` integration secret | Generated — see Setup |
| `VISIT_LOOKBACK_DAYS` | `string` | `365` | no | Days of visit history considered current (default: `365`) | — |
| `PORTAL_BASE_URL` | `string` | `https://portal.demo.example` | no | Base URL for the patient portal (demo mode) | — |

> **Agent / CLI access** — all of the above can be provisioned from the CLI/agent without the portal:
>
> ```bash
> telnyx auth set-key KEY…                                # human CLI auth (or TELNYX_API_KEY env var for agents)
> telnyx-edge new-func --actor -l ts -n per-caller-intake # register the agent function
> telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY" # Ed25519 verification key
> telnyx-edge secrets add PORTAL_ENC_KEY "$KEY"           # AES-256 credential key
> telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$TOKEN"   # filing-tool bearer token
> telnyx-edge ship                                        # deploy (~5-10 min)
> ```

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 20+ and npm
- [API key](https://portal.telnyx.com/api-keys)

### 1. Install and smoke-test

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/per-caller-intake
npm install
npx tsc --noEmit
npm run smoke
```

The smoke test exercises the real crypto (AES-256-GCM envelope round trip, Ed25519 signature verification, tamper/stale/wrong-key rejection) and the exact `assistant.initialization` envelope parsing — no account access needed.

### 2. Generate the credential key and register it twice

One 32-byte key, stored in two places that must match: as the assistant-facing integration secret `portal_enc_key` (Telnyx decrypts with it) and as the edge secret `PORTAL_ENC_KEY` (the webhook encrypts with it):

```bash
KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')

# Edge secret — the webhook encrypts with this
telnyx-edge secrets add PORTAL_ENC_KEY "$KEY"

# Integration secret — the assistant references it as {{portal_token | portal_enc_key}}
curl -X POST https://api.telnyx.com/v2/integration_secrets \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"portal_enc_key\", \"type\": \"bearer\", \"token\": \"$KEY\"}"
```

The Integration Secrets API never returns the token value, so the edge function keeps its own copy — the two must stay in sync (rotate both together).

### 3. Store the Ed25519 public key for webhook verification

```bash
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
```

### 4. Create the filing-tool auth token

```bash
TOKEN=$(openssl rand -hex 24)

telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$TOKEN"

# The assistant's filing tool sends it via the integration-secret mustache:
#   Authorization: Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}
curl -X POST https://api.telnyx.com/v2/integration_secrets \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"dossier_webhook_auth\", \"type\": \"bearer\", \"token\": \"$TOKEN\"}"
```

### 5. Deploy

```bash
npm install
telnyx-edge ship
```

`ship` prints a URL like `per-caller-intake-<id>.telnyxcompute.com`.

### 6. Configure the assistant

Create (or update) the assistant pointing at the deployed URL — full JSON in [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/per-caller-intake/GUIDE.md). Key fields: `dynamic_variables_webhook_url` (+ `dynamic_variables_webhook_timeout_ms: 8000` for edge cold starts), `post_conversation_settings: {enabled: true}`, and one webhook tool `file_visit_summary` whose `Authorization` header uses the `dossier_webhook_auth` integration secret.

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Register the edge function (run from a parent directory that does NOT
# already contain a folder named per-caller-intake)
telnyx-edge new-func -l ts -n per-caller-intake --from-dir ./per-caller-intake
# → copy the printed func_id/func_name into telnyx.toml [edge_compute]

# Secrets (Steps 2-4 above)
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
telnyx-edge secrets add PORTAL_ENC_KEY "$KEY"
telnyx-edge secrets add DOSSIER_WEBHOOK_AUTH "$TOKEN"

# Ship to Telnyx Edge (~5-10 min: upload, build, deploy)
telnyx-edge ship

# Deployed URL is printed at the end; also visible via:
telnyx-edge list

# Then configure the assistant (GUIDE.md Step 6) with:
#   dynamic_variables_webhook_url → https://<your-function>.telnyxcompute.com/webhook/initialization
#   filing webhook tool          → https://<your-function>.telnyxcompute.com/webhook/post-conversation
```

</details>

### 7. Run the two-visit demo

Call the assistant from your phone (or replay the webhooks with curl — scripted in GUIDE.md):

1. **Visit #1** — `POST /webhook/initialization` greets Sarah with `last_visit: "none"` and a fresh encrypted token. Hang up (or end the conversation); the assistant files the visit.
2. **Visit #2** — call again. The same actor returns the updated `last_visit` from SQL and a **new** one-time token — the greeting now references the visit history. Inspect the dossier: `GET /dossier/<phone-digits>`.

> Live-tested: the assistant greets with resolved variables ("the patient is Sarah … their last visit was Oct 9, 2026"), files with the caller's real number, and visit #2's summary references visit #1's history ("prefers morning contact") — the dossier, not the conversation, carried the memory.

## API Reference

### Agent: `IntakeDossier`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `handleInitialization` | `(lookbackDays: number) → DynamicVarsResponse` | Personalization + one-time credential for this conversation |
| `fileVisitSummary` | `(args: FilingArgs) → FilingResult` | Idempotent post-conversation filing |
| `dossierView` | `() → DossierView` | Dev inspection (no token plaintexts) |

Full typed reference in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/per-caller-intake/API.md); walkthrough in [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/per-caller-intake/GUIDE.md).

### Webhook endpoints

#### `POST /webhook/initialization`

Receives the Ed25519-signed `assistant.initialization` event:

```json
{
  "data": {
    "record_type": "event",
    "event_type": "assistant.initialization",
    "payload": {
      "telnyx_end_user_target": "+15551234567",
      "telnyx_end_user_target_verified": false,
      "call_control_id": "v3:u5OAKGEPT3Dx8SZSSDRWEMdNH2OripQhO",
      "assistant_id": "assistant_12345678-90ab-cdef-1234-567890abcdef"
    }
  }
}
```

**Response (200):**

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

#### `POST /webhook/post-conversation`

Receives the wrap-up filing (Authorization: `Bearer <DOSSIER_WEBHOOK_AUTH>`):

```json
{
  "telnyx_end_user_target": "+15551234567",
  "visit_reason": "follow-up",
  "follow_up": "Patient reports improved hearing. Discussed hearing aid maintenance.",
  "next_step": "rescheduled to Thursday"
}
```

**Response (200):** `{ "filed": true, "visit_id": 42 }` — `filed: false` on a deduped retry, with the original `visit_id`.

#### `GET /dossier/<phone-digits>`

Dev dashboard: the full dossier for one caller.

#### `GET /health`

`200 { "status": "ok" }`

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 invalid webhook signature` on initialization | Missing/wrong `TELNYX_PUBLIC_KEY`, tampered body, or stale timestamp | Re-fetch the public key (`GET /v2/public_key`), re-run `telnyx-edge secrets add TELNYX_PUBLIC_KEY`, redeploy |
| `500 server not configured` on either webhook | A required secret is unset | The handlers **fail closed** by design — set the missing secret and redeploy |
| `Unauthorized` on post-conversation | Filing tool header missing the integration-secret mustache | Set the tool header to `Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}` |
| Portal credential never resolves | `PORTAL_ENC_KEY` and the `portal_enc_key` integration secret diverge, or the key is not 32 bytes | Regenerate both from one `openssl rand -base64 32` value; rotate them together |
| Greeting shows raw `{{patient_name}}` | Webhook timed out (default 1.5 s) or returned non-2xx | Set `dynamic_variables_webhook_timeout_ms: 8000` on the assistant; check the edge function logs |
| Duplicate visit rows | Not expected — filing dedupes by `(visit_reason, next_step)` | If seen, confirm the assistant sends identical `visit_reason`/`next_step` strings on retries |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — durable entity agent per phone number (StatefulActors deep-dive)
- [ai-prescription-refill-intake-voice-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-prescription-refill-intake-voice-assistant-python/README.md) — cold-start intake: collects the story fresh every call, no dossier
- [order-status-self-service](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/order-status-self-service/README.md) — the actor IS the *package*: push-only status notifications
- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) — text-only assistant chat (no telephony)

## Resources

- [Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables) — the `assistant.initialization` webhook and variable resolution order
- [Per-Caller Credentials](https://developers.telnyx.com/docs/inference/ai-assistants/per-caller-credentials) — the `encrypted_dynamic_variables` scheme and failure behavior
- [Post-Conversation Processing](https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing) — the wrap-up turn and post-conversation tool availability
- [Agent SDK: SQL Storage](https://developers.telnyx.com/docs/agent-sdk/sql) — embedded per-agent SQLite
- [Agent SDK: Agent Class](https://developers.telnyx.com/docs/agent-sdk/api-reference/agent) — `Agent<E, State>`, state, scheduling
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — one instance per name, serialized turns, durable writes
- [Receiving Webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks) — Ed25519 signature verification
- [AI Assistants product page](https://telnyx.com/ai-assistants)
- [Telnyx pricing](https://telnyx.com/pricing)
- [@telnyx/edge-runtime on npm](https://www.npmjs.com/package/@telnyx/edge-runtime)
