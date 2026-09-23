---
name: omni-channel-inbox-agent
title: "Omni-Channel Inbox Agent"
description: "Build a Telnyx Edge Compute agent that runs a lab-results intake workflow across fax, voice, email, and SMS — with verified channel identity resolution and shared customer context."
language: nodejs
framework: telnyx-edge
telnyx_products: [Edge Compute, AI Inference, Voice, Messaging, Fax, Email]
channel: [fax, voice, email, sms]
---

# Omni-Channel Inbox Agent

Build a Telnyx Edge Compute agent that runs a **lab-results intake workflow** across fax, voice, email, and SMS. The lab faxes a result to the clinic; a human reviews the document and accepts it (the original PDF is deleted from Telnyx, only a reference survives); and a shared, LangGraph-style workflow drafts responses from the same customer context regardless of channel. One durable StatefulActor per canonical customer holds the appointment, fax metadata, email status, and cross-channel interaction history in actor-local SQL.

The sample includes a full admin inbox UI (Telnyx-branded), a live Email Insights dashboard with self-hosted open tracking, and a patient portal page, so you can run the entire journey end-to-end in demo mode before wiring real channels.

## Telnyx APIs Used

- **Edge Compute**: deploys the HTTP handler and the `InboxAgent` actor.
- **Agent SDK**: `class InboxAgent extends Agent` with per-customer actor instances (`env.INBOX.idFromName`).
- **Actor-local SQL**: `this.ctx.storage.sql` — conversations, messages, documents, appointments tables per patient.
- **Telnyx Inference binding**: `this.env.TELNYX.ai.openai.chat.createCompletion()` — zero-credential, no API key in code.
- **Telnyx Call Control**: answer, speak (TTS), transcription_start (Google engine), transcription webhooks.
- **Telnyx Fax API**: `fax.ended` webhook, fax download, and `DELETE /v2/faxes/{id}` (privacy by construction).
- **Telnyx Email API**: `POST /v2/email_messages` (send), inbox reply threading, `email.received` webhook, message events (delivery).
- **Telnyx Messaging API**: `message.received` webhook, `POST /v2/messages` (SMS replies and appointment confirmations).
- **Shared context graph**: normalize → resolve identity → load durable context → draft → approval/send. The graph is implemented without Node-only dependencies so it remains Edge Compute compatible.
- **Identity registry**: verified phone and email aliases resolve to one canonical customer actor. Fax routing requires an explicit patient/CRM mapping; an unknown fax is never merged by destination number.
- **Ed25519 webhook verification**: `telnyx.webhooks.unwrap()` for every inbound webhook.

## Architecture

```text
   Lab faxes result                 Patient books / texts / calls
        |                                        |
        v                                        v
  /webhooks/fax                          /webhooks/messaging + voice
        |                                        |
        v                                        v
  +----------------------------------------------------------+
  |        InboxAgent (one actor per canonical customer)      |
  |  identity registry | shared graph | messages | documents   |
  |                    | appointments | customers             |
  +----------------------------------------------------------+
        |                    |                     |
        v                    v                     v
  Admin inbox UI      AI drafts (Telnyx      Voice: TTS greeting +
  (review/accept)     Inference) + human     transcription + spoken reply
        |             approve per channel
        v
  Email Insights (/insights) — sent / delivered / open rate
  (self-hosted tracking pixel + click redirect)
```

## Why Telnyx

Telnyx gives you AI Communications Infrastructure across voice, messaging, fax, email, and AI behind one authenticated binding. The deployed function calls Telnyx Inference, Call Control, Fax, Email, and Messaging with `this.env.TELNYX` and one API key, while each patient's durable state lives in actor-local SQL on Edge Compute — no external database, no separate inference keys, and every channel webhook verified with the same Ed25519 key.

## Environment Variables

`telnyx.toml` defaults to a safe demo configuration:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `false` | no | Skips Ed25519 webhook signature verification for local testing. Set explicitly to `true` only for local demos. | - |
| `FROM_NUMBER` | `string` | `<your-telnyx-phone-number>` | voice + SMS | Telnyx phone number for voice calls and outbound SMS. | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FAX_NUMBER` | `string` | `<your-telnyx-fax-number>` | fax | Telnyx number that receives lab-result faxes. | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TEXML_APP_ID` | `string` | `1234567890` | voice | Call Control / TeXML application id wired to `/webhooks/voice`. | [Voice API Apps](https://portal.telnyx.com/voice-api/applications) |
| `FAX_APP_ID` | `string` | `1234567890` | fax | Fax application id wired to `/webhooks/fax`. | [Fax API Apps](https://portal.telnyx.com/fax/applications) |
| `VOICE_ASSISTANT_ID` | `string` | `assistant-…` | no | Optional AI assistant persona id. | [AI Assistants](https://portal.telnyx.com/ai/assistants) |
| `AI_MODEL` | `string` | `zai-org/GLM-5.2` | no | Telnyx Inference model for drafts. | [Inference models](https://developers.telnyx.com/docs/inference/models) |
| `TTS_VOICE` | `string` | `Telnyx.Ultra.…` | no | TTS voice for Call Control speak. | - |
| `DEMO_PATIENT_EMAIL` | `string` | `patient@example.com` | demo | Patient identity the demo journey routes to. | - |
| `DEMO_PATIENT_PHONE` | `string` | `<demo-patient-phone>` | demo | Patient phone the unified actor is keyed by. | - |
| `DEMO_PATIENT_NAME` | `string` | `Jane` | demo | Patient display name for appointment SMS. | - |
| `PORTAL_URL` | `string` | `https://portal.example.com` | no | Portal base URL rewritten into tracked email links. | - |
| `PUBLIC_BASE_URL` | `string` | `https://your-func.telnyxcompute.com` | yes | Deployed function URL used for open-tracking pixels and click redirects. | Output of `telnyx-edge ship` |

For production webhooks, also store `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `EMAIL_FROM`, `TELNYX_EMAIL_INBOX_ID`, and `ADMIN_TOKEN` as Edge secrets.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omni-channel-inbox-agent
npm install
npm run typecheck
npm run types
```

Authenticate the Edge CLI:

```bash
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge status
```

For a fresh deployable function, scaffold with the CLI so Telnyx assigns a function ID:

```bash
telnyx-edge new-func --actor --name=omni-channel-inbox-agent
```

Then copy this sample's `src/`, docs, dependencies, and binding blocks into the generated project. Keep the generated `[edge_compute]` `func_id`.

Add the required Edge secrets:

```bash
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$TELNYX_PUBLIC_KEY"
telnyx-edge secrets add ADMIN_TOKEN "$(openssl rand -hex 24)"
telnyx-edge secrets add EMAIL_FROM "lab-results@your-domain.com"
telnyx-edge secrets add TELNYX_EMAIL_INBOX_ID "<your email inbox id>"
```

Set `PUBLIC_BASE_URL` in `telnyx.toml` to the deployed function URL, then ship:

```bash
telnyx-edge ship
```

Wire the webhooks in the portal (or via API): Call Control/TeXML app → `<PUBLIC_BASE_URL>/webhooks/voice`, Fax application → `/webhooks/fax`, email domain webhooks → `/webhooks/email`, messaging profile → `/webhooks/messaging`.

## Demo Mode

With `DEMO_MODE = "true"` explicitly set for local testing:

- `POST /api/demo/simulate-fax` simulates the lab fax (no real fax needed) — the document appears in the inbox with a generated `LAB-YYYYMMDD-NNN` reference.
- The admin inbox at `/` shows one unified case timeline for the demo patient; every message retains its source channel for correct delivery.
- **Accept** deletes the original fax from Telnyx storage (`DELETE /v2/faxes/{id}`) and drafts the results-ready email. Privacy by construction: the AI only ever sees document metadata, never lab content.
- **Approve & send** delivers email from your configured sender, tracked with a self-hosted pixel. Low-risk SMS replies are auto-sent; email remains human-approved.
- **Book appointment** texts the patient an SMS confirmation (date computed dynamically, no floor info) — text it back "what floor?" and the agent answers from the appointment record.
- `/insights` shows Sent / Delivered / Open rate from live tracking events.

Run the whole journey: book → visit → fax → review → accept → approve email → call the hotline → open the email → watch the open rate move on the dashboard.

## Context and identity guarantees

The sample separates three concepts:

- `customer_id`: the long-lived canonical actor and cross-channel memory boundary.
- `case_id`: the unified customer case and operator timeline.
- `conversation_id`: the inbox record for that case; individual messages retain their channel for delivery.
- graph state: the durable workflow checkpoints, including drafts and human approval.

Every inbound message is persisted before the graph runs. The graph rebuilds context from actor-local SQL across voice, SMS, email, and fax metadata; it does not rely on a channel-local transcript. All channels for a resolved customer attach to one open case and one operator timeline. Phone and email aliases registered for the same customer resolve to the same actor. Fax routing requires an explicit mapping. An unknown identity is not guessed into an existing customer.

The implementation follows the LangGraph model of explicit state transitions and resumable approval, but does not bundle `@langchain/langgraph` into Edge Compute. If you move orchestration to a Node service, `src/omniGraph.ts` is the replacement boundary for a full LangGraph `StateGraph` with a persistent checkpointer and customer-scoped store.

RCS and WhatsApp are not implemented by this example and are intentionally excluded from `ENABLED_CHANNELS`.

## API Reference

All `/api/*` routes are demo endpoints (no auth in demo mode; add your own auth for production).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Admin inbox UI |
| `GET` | `/insights` | Email Insights dashboard |
| `GET` | `/portal?ref=…` | Patient portal landing page (email link target) |
| `GET` | `/health` | Status + configured channels |
| `POST` | `/webhooks/voice` | Call Control webhook (answer, greeting, transcription, TTS reply) |
| `POST` | `/webhooks/fax` | `fax.ended` webhook (document intake) |
| `POST` | `/webhooks/email` | `email.received` webhook (inbound replies) |
| `POST` | `/webhooks/messaging` | `message.received` webhook (inbound SMS + rule-based auto-replies) |
| `GET` | `/api/conversations` | List conversations (filter: `channel`, `status`) |
| `POST` | `/api/identity/link` | Explicitly link a verified channel address to a canonical customer actor |
| `GET` | `/api/messages?conversation_id=&customer_id=` | Thread messages |
| `POST` | `/api/draft/edit` | Edit an AI draft before approval |
| `POST` | `/api/draft/approve` | Approve and send on the draft's channel |
| `POST` | `/api/reply` | Operator reply on any channel |
| `POST` | `/api/document/accept` | Accept → delete the Telnyx fax → draft the email |
| `POST` | `/api/document/reject` | Reject → delete the fax |
| `GET` | `/api/document/download?document_id=&customer_id=` | Download the fax PDF (before acceptance) |
| `POST` | `/api/appointment/book` | Book appointment + SMS confirmation |
| `POST` | `/api/appointment/complete` | Mark visit complete + follow-up SMS |
| `GET` | `/api/patient-record?patient_phone=` | The actor's memory: appointment + lab documents + email status |
| `POST` | `/api/demo/reset` | Sweep all demo state (every registered actor) |
| `GET` | `/email/open/{customerId}/{documentId}` | Self-hosted open-tracking pixel (1x1 GIF) |
| `GET` | `/email/click/{customerId}/{documentId}` | Click-tracking redirect → portal |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 page not found` | Function still deploying | Wait ~30s and retry |
| `TELNYX_API_KEY not configured` | Secret not set | `telnyx-edge secrets add TELNYX_API_KEY <key>` |
| Call connects but no greeting | TTS voice unavailable | Try `TTS_VOICE = "Telnyx.KokoroTTS.af"` |
| No transcript after speaking | Transcription engine mismatch | This sample uses the `Google` engine on `transcription_start`; the `Telnyx` engine does not emit `call.transcription` webhooks on the legacy action |
| Inbound SMS not stored | Real Telnyx payloads send `from` as an object | Fixed in this sample's webhook parser (handles string, object, and array shapes) |
| Webhook returns 401 | Ed25519 signature mismatch | Confirm `TELNYX_PUBLIC_KEY` matches your org (`GET /v2/public_key`) or explicitly set `DEMO_MODE=true` for local testing only |
| Open rate stays 0% | Telnyx shared email domains have tracking locked | This sample self-hosts the tracking pixel on the Edge function; or verify a custom domain and enable `tracking.open_tracking` |
| `email_inbox: null` on /health | Email secret missing | `telnyx-edge secrets add TELNYX_EMAIL_INBOX_ID <id>` |

## Related Examples

- [Agent with Tool Calling](https://github.com/team-telnyx/telnyx-code-examples/tree/main/agent-with-tool-calling) — the same Agent SDK pattern with LLM tool dispatch.
- [AI Appointment Booking SMS Flow (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-appointment-booking-sms-flow-python) — SMS-first scheduling flow.
- [After-Hours Nurse Triage (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/after-hours-nurse-triage-python) — voice triage on Telnyx AI.

## Agent Discovery

This example is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: lab-results intake across fax, voice, email, and SMS with human-in-the-loop approvals.
- **Runtime**: Node.js on Telnyx Edge Compute Stateful Actors.
- **Primary APIs**: Telnyx Inference, Call Control, Fax, Email, Messaging, and actor-local SQL.
- **Entry point**: `src/index.ts`.
- **Stateful actor**: `src/inboxAgent.ts` holds one actor per patient — conversations, messages, documents, and appointments in actor-local SQL, with admin, insights, and portal UIs served from the same function.

## Resources

- [Edge Compute docs](https://developers.telnyx.com/docs/edge-compute)
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Call Control docs](https://developers.telnyx.com/docs/voice/call-control)
- [Fax API docs](https://developers.telnyx.com/docs/fax)
- [Email API docs](https://developers.telnyx.com/docs/messaging/email/overview)
- [Telnyx pricing](https://telnyx.com/pricing)
