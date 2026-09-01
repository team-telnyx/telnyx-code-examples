---
name: omni-channel-lab-inbox-agent
title: "Omni-Channel Lab Inbox Agent"
description: "Lab-result fax intake with a human-in-the-loop inbox: fax received, operator reviews and accepts (fax deleted, only reference kept), AI drafts confirmation email, SMS appointment flow, and a voice agent that answers status questions without touching lab content."
language: nodejs
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, Fax, Voice AI, SMS, Email, AI Inference]
---

# Omni-Channel Lab Inbox Agent

A stateful AI agent on Telnyx Edge Compute that runs a **lab-result intake workflow** across fax, voice, SMS, and email. A human operator reviews incoming faxes in a unified inbox, accepts them (the original fax is deleted — only a reference number and status survive), approves AI-drafted confirmation emails, and the voice agent answers patient calls without ever touching lab content.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, fax, email, and AI inference on one private global network. This example composes Programmable Fax, Call Control, SMS, the Email API, and AI Assistants on one Edge Compute function with durable per-customer state — one platform, one API key, one bill.

## Telnyx APIs Used

| API | Usage |
|-----|-------|
| Programmable Fax | `fax.ended` webhook, `GET /v2/faxes/{id}` (media URL), `DELETE /v2/faxes/{id}` (privacy deletion), `POST /v2/faxes` (demo fax send) |
| Call Control | `answer`, `speak` (TTS), `transcription_start/stop`, `hangup` |
| AI Assistants | Managed voice assistant with a webhook tool (`lookup_lab_document`) that calls back into the Edge function mid-call |
| AI Inference | `env.TELNYX.ai.openai.chat.createCompletion` — zero-credential reply drafting |
| SMS | `POST /v2/messages` (appointment confirmation, completion, status replies) + `message.received` webhook |
| Email API | `POST /v2/email_messages` (confirmation sends), `GET /v2/email_messages/{id}/events` (delivery timeline), `email.received` webhook |
| Stateful Actors | `Agent<E, State>` base class, per-actor SQLite (`ctx.storage.sql`) |

## Architecture

```
  Hospital Lab                    Operator (Centralized Inbox UI)
       │ fax                            ▲  review / Accept / approve
       ▼                                │  send email / mark complete
  fax.ended webhook ──▶ ┌─────────────────────────────────────┐
                        │  Telnyx Edge Compute function        │
  Patient call ──────▶  │  ┌─────────────────────────────┐    │
  (voice AI + tool)     │  │ InboxAgent (Stateful Actor) │    │
                        │  │  ctx.storage.sql (SQLite):  │    │
  Patient SMS ───────▶  │  │   documents, appointments,  │    │
  (auto-answered)       │  │   conversations, messages   │    │
                        │  └─────────────────────────────┘    │
  Confirmation email ◀──└─────────────────────────────────────┘
  (Email API + delivery events)
```

### Workflow

1. Hospital lab faxes the finalized result PDF to the intake number
2. `fax.ended` webhook fires → document record created with a case reference (`LAB-YYYYMMDD-NNN`) → appears in the inbox UI
3. Operator downloads and reviews the PDF — the only persona that sees lab content
4. Operator clicks Accept → the original fax is deleted from Telnyx; only the reference, status, and timestamps survive
5. AI drafts a confirmation email from metadata only; operator reviews and sends
6. Delivery events (queued → sent → delivered) render live in the UI
7. Patient texts the intake number → AI auto-answers location/appointment/status questions
8. Patient calls → voice assistant verifies the case reference → reports "results were already emailed to you — check your inbox" → escalates anything clinical to staff

### The safety boundary

The AI never reads or interprets lab values. Its only tool returns workflow status (received/accepted/emailed) — lab content is architecturally unreachable. After Accept, no lab content persists anywhere. Every outbound message requires human approval.

## Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.4.1+
- Node.js 18+
- A Telnyx account with: a voice number + Call Control app, a fax-capable number + Fax app, an AI Assistant, an Email API inbox on a verified domain, and an outbound SMS-capable number

## Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omni-channel-lab-inbox-agent
npm install
```

### 2. Configure `telnyx.toml`

Fill in the `[env_vars]` placeholders: `FROM_NUMBER`, `FAX_NUMBER`, `TEXML_APP_ID`, `FAX_APP_ID`, `VOICE_ASSISTANT_ID`, `DEMO_PATIENT_*` (a stand-in patient for the simulated appointment flow).

### 3. Store secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_api_key"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/public_key | jq -r '.data.public')"
telnyx-edge secrets add EMAIL_FROM "lab-results@yourdomain.com"
telnyx-edge secrets add TELNYX_EMAIL_INBOX_ID "your_inbox_id"
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Phone numbers (voice + fax)
telnyx number-orders create --phone-number "+15550001111"
telnyx number-orders create --phone-number "+15550002222"

# Call Control application (webhook → /webhooks/voice)
telnyx call-control-applications create \
  --application-name "lab-inbox-voice" \
  --webhook-event-url "https://<your-func>.telnyxcompute.com/webhooks/voice" \
  --webhook-api-version 2

# Fax application (webhook → /webhooks/fax)
telnyx fax-applications create \
  --application-name "lab-inbox-fax" \
  --webhook-event-url "https://<your-func>.telnyxcompute.com/webhooks/fax" \
  --webhook-api-version 2

# AI Assistant with the lab-document lookup webhook tool
# (see GUIDE.md for the full tool payload)

# Email domain + inbox (Email API)
curl -X POST https://api.telnyx.com/v2/email_inboxes \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{"username": "lab-results"}'
```

</details>

### 4. Deploy

```bash
telnyx-edge new-func --actor --name=omni-channel-lab-inbox-agent
# copy the printed func_id into telnyx.toml [edge_compute]
npm run ship
```

### 5. Wire the webhooks

Point the Call Control app, Fax app, Messaging profile, and Email domain webhook at the deployed function's `/webhooks/voice`, `/webhooks/fax`, `/webhooks/messaging`, and `/webhooks/email` routes.

### 6. Test

```bash
curl https://<your-func>.telnyxcompute.com/health
```

Open the function URL in a browser for the admin inbox. Click **Simulate incoming fax**, **Book appointment**, and **Mark visit complete** to run the demo flow without external systems.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Service status + configured channels |
| `GET` | `/` | Admin inbox UI |
| `GET` | `/db` | Raw SQLite table viewer |
| `POST` | `/webhooks/voice` | Call Control events (Ed25519-verified in prod) |
| `POST` | `/webhooks/fax` | `fax.ended` → document intake |
| `POST` | `/webhooks/messaging` | Inbound SMS → AI auto-reply |
| `POST` | `/webhooks/email` | `email.received` → AI reply draft |
| `GET` | `/api/documents` | List lab documents |
| `POST` | `/api/document/accept` | Accept: delete fax, keep reference + status |
| `POST` | `/api/document/reject` | Reject: delete fax, no follow-up |
| `GET` | `/api/document/download` | Fresh-signed PDF download (single-use workflow) |
| `POST` | `/api/document/draft-email` | AI-drafted confirmation from metadata |
| `POST` | `/api/draft/approve` | Approve & send (to patient email on file) |
| `GET` | `/api/email-events` | Telnyx email delivery events per message |
| `POST` | `/api/appointment/book` | Book appointment + SMS confirmation |
| `POST` | `/api/appointment/complete` | Complete visit + SMS notification |
| `GET` | `/api/patient-record` | Non-clinical patient state (appointment, docs, email flags) |
| `POST` | `/ai-assistant/lookup` | Voice-agent tool: lab document status by reference |
| `POST` | `/api/demo/simulate-fax` | Demo: simulate an incoming fax |
| `POST` | `/api/demo/reset` | Demo: reset the patient's state |

## SQL Schema

Per-actor SQLite (`ctx.storage.sql`): `documents` (fax intake + workflow state), `appointments`, `conversations`, `messages` — all channel-typed with workflow status columns. After Accept, `documents.fax_id` and `fax_url` are nulled; only `id`, `reference`, `status`, and timestamps survive.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 page not found` | Function still deploying | Wait ~30s, retry |
| Call answers, then silence | `TELNYX_API_KEY` secret missing | `telnyx-edge secrets add TELNYX_API_KEY <key>` |
| Download fails with 400/502 | Simulated doc has no real fax | Simulated docs serve the hosted sample PDF automatically |
| Fax webhook not firing | Check the Fax app webhook URL matches the deployed function | Re-point via Portal or API |
| Email lands in spam | Shared sending domain reputation | Use a custom verified domain with DKIM/SPF/DMARC |
| Voice agent has no lab info | Lookup tool not attached | See GUIDE.md for the tool payload |
| Actor invocation error mentioning RFC 1123 | Actor name contains `+`/`@` | Fixed in code — actor names strip non-alphanumerics |

## Related Examples

- [Multi-Model Inference Switcher (TypeScript, Agent SDK + admin UI)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/README.md)
- [Edge Voice Agent That Holds a Call (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voice-agent-holds-call/README.md)
- [Agent SMS Triage Bot (TypeScript, Agent SDK + KV)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md)
- [AI Lab Results Notification Voice Agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-lab-results-notification-voice-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli)
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli)

## Resources

- [Programmable Fax Guide](https://developers.telnyx.com/docs/voice/programmable-fax)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Email API Overview](https://developers.telnyx.com/docs/messaging/email/overview)
- [AI Assistants Guide](https://developers.telnyx.com/docs/ai-assistants)
- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
