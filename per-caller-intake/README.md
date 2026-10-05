```markdown
---
name: per-caller-intake
title: "Per-Caller Intake Concierge"
description: "A durable per-caller actor that greets returning patients with personalized dynamic variables and a fresh encrypted one-time portal token on each call."
language: typescript
framework: edge
telnyx_products: [AI Assistants, Agent SDK, Stateful Actors, Dynamic Variables, Per-Caller Credentials, Post-Conversation Processing, SQL Storage]
---

# Per-Caller Intake Concierge

A durable per-caller actor that greets returning patients with personalized dynamic variables and a fresh encrypted one-time portal token on each call.

## The Story

An ear, nose, and throat clinic's assistant greets every caller by who they are — Sarah hears "Dr. Lee is expecting you for your 2:15 follow-up," not a generic menu. If the system forgets her last visit, her balance, or her provider, she repeats her story every time, eroding trust and risking missed care. The actor IS the returning patient's intake dossier. Born the moment Sarah's phone number hits the initialization webhook, it reads her visit history from SQL, returns personalized variables plus an encrypted one-time portal token, and survives every platform reboot between calls. When the conversation ends, a post-conversation webhook tool files the assistant's structured summary into the durable dossier — so visit #3 knows what visit #2 said, forever. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that makes per-caller personalization durable, secure, and auditable — combining AI Assistants with dynamic variables, per-caller encrypted credentials, post-conversation processing, and stateful actors backed by SQL storage.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|----------|---------|---------|
| `POST /v2/ai/assistants` | AI Assistants | Assistant with `dynamic_variables_webhook_url` and `post_conversation_settings` |
| `POST /v2/ai/assistants/{id}/dynamic_variables` | AI Assistants | Webhook receives `assistant.initialization` with `telnyx_end_user_target` |
| `POST /v2/ai/assistants/{id}/post_conversation` | AI Assistants | Webhook receives wrap-up turn output for filing |
| `POST /integration_secrets` | AI Assistants | Stores the 32-byte AES-GCM key as `portal_enc_key` |
| `GET /integration_secrets/{id}` | AI Assistants | Retrieves the encryption key for token encryption |
| `POST /calls` | Call Control | (Demo mode: no real calls placed) |
| Agent SDK `env.DOSSIERS.idFromName()` | Agent SDK / Stateful Actors | One durable actor per caller phone number |
| `env.DOSSIER_DB.prepare()` | Agent SDK / SQL Storage | Persists visits, prefs, and dossier state |

## Architecture

```
Patient phone ──AI Assistant──> dynamic_variables_webhook_url
                                      │
                                      ▼
                           /webhook/initialization
                                      │
                                      ▼
                    IntakeDossier actor (Agent SDK)
                    env.DOSSIERS.idFromName(phoneDigits)
                    ├── SQL: visits, prefs tables
                    ├── Returns: dynamic_variables (plain)
                    │           + encrypted_dynamic_variables (portal_token)
                    └── AES-GCM encrypt with integration secret key
                                      │
                                      ▼
                    Assistant greets: "Hi Sarah — Dr. Lee..."
                    Tool call decrypts {{portal_token | portal_enc_key}}
                    for this conversation only
                                      │
                                      ▼
                    Conversation ends → post_conversation_settings
                                      │
                                      ▼
                           /webhook/post-conversation
                                      │
                                      ▼
                    IntakeDossier.fileVisitSummary()
                    ├── Idempotent insert (dedupes retries)
                    └── Updates SQL + durable state
                                      │
                                      ▼
                    Next call → same actor → fresh token + history
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `VISIT_LOOKBACK_DAYS` | `string` | `365` | no | Days to look back for visit history (default: `365`) | — |
| `PORTAL_ENC_KEY_REF` | `string` | `portal_enc_key` | **yes** | Integration secret identifier for the AES-GCM encryption key | Telnyx Portal → Integration Secrets |
| `DOSSIER_WEBHOOK_AUTH` | `string` | `your_webhook_auth_token_here` | **yes** | Bearer token for authenticating post-conversation webhook calls | Set via `telnyx-edge secrets add` |
| `PORTAL_BASE_URL` | `string` | `https://portal.example.com` | no | Base URL for the patient portal (demo mode) | — |
| `FILE_RETRY_MAX` | `string` | `3` | no | Maximum retry attempts for filing visit summaries | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/per-caller-intake

# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env with your Telnyx API key and integration secret references

# Generate typed env bindings
npx telnyx-edge types

# Run smoke test
npx tsx smoke_test.ts

# Deploy
npx telnyx-edge ship
```

## API Reference

### `IntakeDossier` Actor

#### `handleInitialization(payload)`

Called by the `/webhook/initialization` endpoint when Telnyx AI Assistants fires `assistant.initialization`.

**Parameters:**
- `payload.telnyx_end_user_target` — The caller's phone number (E.164 format)

**Returns:**
```json
{
  "dynamic_variables": {
    "patient_name": "Sarah",
    "provider": "Dr. Lee",
    "last_visit": "Jan 15, 2025",
    "balance_due": "$0.00"
  },
  "encrypted_dynamic_variables": {
    "portal_token": "<base64 IV+ciphertext>"
  }
}
```

#### `fileVisitSummary(args)`

Called by the `/webhook/post-conversation` endpoint to file the assistant's wrap-up summary.

**Parameters:**
- `args.telnyx_end_user_target` — Caller's phone number
- `args.visit_reason` — Reason for the visit
- `args.follow_up` — Follow-up notes from the assistant
- `args.next_step` — Next step action

**Returns:**
```json
{
  "filed": true,
  "visit_id": 42
}
```

#### `dossierView()`

RPC method for dev inspection of the dossier.

**Returns:**
```json
{
  "visits": [...],
  "state": {
    "alertedFile": true,
    "lastVisitAt": "2025-01-15T10:30:00.000Z",
    "fileRetryCount": 0
  }
}
```

### Webhook Endpoints

#### `POST /webhook/initialization`

Receives `assistant.initialization` from Telnyx AI Assistants.

**Request:**
```json
{
  "telnyx_end_user_target": "+15551234567",
  "event_type": "assistant.initialization"
}
```

**Response:** `200 OK` with `DynamicVarsResponse`

#### `POST /webhook/post-conversation`

Receives the assistant's wrap-up turn output.

**Headers:** `Authorization: Bearer <DOSSIER_WEBHOOK_AUTH>`

**Request:**
```json
{
  "telnyx_end_user_target": "+15551234567",
  "visit_reason": "annual checkup",
  "follow_up": "Patient reports improved symptoms",
  "next_step": "Schedule follow-up in 6 months"
}
```

**Response:** `200 OK` with `{ filed: boolean, visit_id?: number }`

#### `GET /health`

Health check endpoint.

**Response:** `200 OK` with `{ status: "ok" }`

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `PORTAL_ENC_KEY_REF not configured` | Integration secret not set | Run `telnyx-edge secrets add PORTAL_ENC_KEY_REF "<base64-key>"` |
| `Missing telnyx_end_user_target` | Webhook payload missing caller ID | Verify assistant is configured with `dynamic_variables_webhook_url` |
| `Unauthorized` on post-conversation | Missing or invalid bearer token | Set `DOSSIER_WEBHOOK_AUTH` secret and include in Authorization header |
| Duplicate visit rows | Idempotency check failing | Verify `phone_digits`, `reason`, and `next_step` match exactly |
| Actor not found | Phone number format mismatch | Ensure E.164 format is used consistently |
| `VISIT_LOOKBACK_DAYS` not respected | Env var not set | Set in `.env` or via `telnyx-edge secrets add` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-284** — Refill Intake (cold-start intake, no memory)
- **DEV-1186/1187** — Appointment Scheduling Intake (cold-start, no per-caller credentials)
- **DEV-1216** — Assistant-Side Memory API (assistant-side memory, not webhook-side personalization)

## Resources

- [Dynamic Variables Documentation](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
- [Per-Caller Credentials Documentation](https://developers.telnyx.com/docs/inference/ai-assistants/per-caller-credentials)
- [Post-Conversation Processing Documentation](https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing)
- [AI Assistants Memory Documentation](https://developers.telnyx.com/docs/inference/ai-assistants/memory)
- [Agent SDK SQL Documentation](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK Scheduling Documentation](https://developers.telnyx.com/docs/agent-sdk/api-reference/agent/scheduling)
- [Stateful Actors Documentation](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx AI Assistants Product Page](https://telnyx.com/ai-assistants)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Edge Runtime SDK](https://www.npmjs.com/package/@telnyx/edge-runtime)
```
