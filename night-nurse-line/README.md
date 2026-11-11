---
name: night-nurse-line
title: "Night Nurse Line — After-Hours Triage Chat With a Memory"
description: "A durable per-patient nurse-line actor that keeps an overnight web chat alive across visits, pages the on-call once, and hands off a morning report."
language: typescript
framework: edge
telnyx_products: [AI Assistants, Messaging, Conversations, Edge Compute]
---

# Night Nurse Line — After-Hours Triage Chat With a Memory

A durable, per-patient triage actor that remembers tonight's symptoms, yesterday's med changes, and the fact that this patient already called twice about the same chest pain — then pages the on-call exactly once.

## The Story

An OB/GYN clinic runs an after-hours nurse line, and every night a pregnant patient types "chest tightness since dinner, 32 weeks pregnant" into the website chat at 11pm. If that message lands in a stateless chatbot that has forgotten the patient's meds, allergies, and the page it already sent an hour ago, the clinic either misses a red flag or double-pages a sleeping physician — and in a maternity ward, a missed red flag is a patient-safety event, not a support ticket. The actor IS the night nurse line: one durable entity per patient handle, born the moment Maya's first message arrives, carrying her chart — symptoms, meds, allergies, pregnancy weeks, and a page-once guard — across every visit that night and the follow-ups on Wednesday. It evolves as the conversation does: it red-flags the chest tightness, calls the Assistant Chat API with the same `conversation_id` so the assistant never loses the thread, fires a single on-call SMS through a scheduled event, and then survives the pod being killed mid-conversation — when Maya's next message re-wakes it, the symptom log and `pageSent` flag are still there, so no second page goes out. It completes its arc at 9am when the clinic-wide morning report rolls up 3 chats, 1 page, and 0 self-care cases for the day team, and it keeps living for the next overnight shift. The rest of this README is the API surface of that story.

## Why Telnyx

The night nurse line is only as good as the communications plumbing underneath it, and that is exactly what Telnyx provides as **AI Communications Infrastructure**: AI Assistants run the triage conversation (text-only web chat via the widget or the Assistant Chat API), Messaging delivers the on-call page and the rota-change SMS, and Conversations gives the morning report a transcript to read back. The Edge runtime's durable `Agent` class is what makes the whole thing stateful — the chart, the page-once guard, and the rota override live in the actor, not in a browser tab, so a pod restart does not erase a page that already went out. One platform, one set of credentials, one bill, and a single `TELNYX` binding for SMS plus a REST call for the assistant chat.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/assistants/{assistant_id}/chat` | `POST` | Assistant Chat API — sends the patient turn with `content`, `name`, and `conversation_id`; returns `{ content, conversation_id }` with a `TRIAGE:` suffix the actor parses. |
| `/v2/messages` (via `env.TELNYX.messages.send`) | `POST` | On-call page SMS and the daily handoff SMS to the day team. |
| `/v2/ai/conversations/{id}/messages` | `GET` | Transcript readback — the actor ingests the widget path's conversation (chart extraction + page guard). |
| Inbound Message Webhook → `POST /sms` | `POST` | Clinic manager's `ONCALL +1...` rota change and `PATIENT <handle> <text>` SMS replies; Ed25519 signature verified. |

## Architecture

```
                       ┌──────────────────────────────────────────────┐
   Browser (Path A)    │  GET /widget  →  <telnyx-ai-agent text-only>  │
   ─────────────────►  │  widget talks to Telnyx directly (no key)     │
                       └──────────────────────────────────────────────┘
                       │ agent.connected / transcript.item bridge
                       │ POST /conversation { patientId, conversationId }
                                        ▼
   Browser (Path B)    ┌──────────────────────────────────────────────┐
   ─────────────────►  │  GET /  →  relay page  →  POST /chat          │
                       └───────────────────┬──────────────────────────┘
                                           │ { patientId, text, conversationId }
                                           ▼
                       ┌──────────────────────────────────────────────┐
                       │  env.NURSES.idFromName("maya-481")           │
                       │  ┌────────────────────────────────────────┐  │
                       │  │ NightNurse extends Agent                │  │
                       │  │  state: symptoms, meds, allergies,     │  │
                       │  │         redFlag, pageSent, chats...    │  │
                        │  │  chat()  → Assistant Chat API          │  │
                        │  │  ingestConversation() → readback        │  │
                        │  │  pageOnCall() → schedule(0) → SMS      │  │
                        │  │  report(day) → per-patient ledger      │  │
                       │  └───────┬────────────────────┬───────────┘  │
                       └──────────┼────────────────────┼──────────────┘
                                  │                    │
                    ┌─────────────▼──────┐   ┌─────────▼─────────────┐
                    │ Assistant Chat API │   │ env.ROTAS             │
                    │ POST /v2/ai/...    │   │ RotaDesk.current()    │
                    │ returns TRIAGE:... │   │ rota row in CLINIC_DB │
                    └────────────────────┘   └───────────────────────┘
                                  │
                    ┌─────────────▼──────────────────────────────────┐
                    │ CLINIC_DB (agent SQL)                          │
                    │  patient_chart · sessions · pages · rota       │
                    └─────────────┬──────────────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐   ┌──────────────┐
                    │ ClinicDesk (every 86400s)  │   │ TELNYX SMS   │
                    │ dailyHandoff → DAY_TEAM    │   │ on-call page │
                    └────────────────────────────┘   └──────────────┘
```

**Data flow.** The relay page (`GET /`) posts each completed patient turn to `POST /chat`, which resolves `env.NURSES.idFromName(patientId)` and calls the actor's `chat()` RPC. The actor calls the Assistant Chat API with the stored `conversation_id`, parses the trailing `TRIAGE: <self-care|appointment|page-on-call>` line out of the reply, extracts chart facts from the raw patient text, writes `patient_chart` rows, and — only when the verdict is `page-on-call` and `state.pageSent` is false — schedules `pageOnCall` at delay 0. `pageOnCall` asks `RotaDesk.current()` for the live on-call number and sends the SMS through `env.TELNYX.messages.send`. The widget path (`GET /widget`) talks to Telnyx directly: the page's bridge script forwards `agent.connected` (which carries the `conversationId`) and every `transcript.item` to `POST /conversation`, and the actor ingests the conversation via `GET /v2/ai/conversations/{id}/messages` — same chart extraction, same page-once guard, no double page.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `NIGHT_NURSE_ASSISTANT_ID` | `string` | `asst_abc123` | **yes** | Assistant ID created by the setup script; its instructions must end every reply with `TRIAGE: <self-care\|appointment\|page-on-call>`. | Telnyx Portal → AI Assistants, or the setup curl in Setup |
| `ONCALL_E164` | `string` | `+1555XXXXXXX` | **yes** | Seed value for the on-call rota; RotaDesk initializes its row from this on first boot. | Your on-call phone (E.164) |
| `DAY_TEAM_E164` | `string` | `+1555XXXXXXX` | no | Destination for the once-daily handoff summary SMS. | Clinic day-team phone (E.164) |
| `FROM_E164` | `string` | `+1555XXXXXXX` | live mode only | Telnyx number the page and handoff SMS are sent from. | Telnyx Portal → Numbers |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) logs SMS instead of sending; `false` sends for real. | — |
| `TELNYX_PUBLIC_KEY` | `string` | `base64_ed25519_key` | live mode only | Verifies the Ed25519 signature on inbound `/sms` webhooks. | Telnyx Portal → API Keys → Public Key |

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/night-nurse-line

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# edit .env and fill in TELNYX_API_KEY, NIGHT_NURSE_ASSISTANT_ID, ONCALL_E164

# 4. Authenticate the Edge CLI and generate binding types
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge types

# 5. Create the assistant (instructions must end replies with TRIAGE: <verdict>)
#    scripts/setup_assistant.sh does this with curl and prints the assistant id.
bash scripts/setup_assistant.sh

# 6. Deploy
telnyx-edge ship
```

The sample runs in **safe demo mode by default** (`DEMO_MODE=true`): every SMS is logged with a masked destination and never sent, so you can walk the whole flow — chat, triage, page, handoff — without a Telnyx number or a charge. Set `DEMO_MODE=false` and provide `FROM_E164` plus `TELNYX_PUBLIC_KEY` to send real messages. See `GUIDE.md` for the full demo-vs-live walkthrough.

Point the demo number's **Inbound Message Webhook** at `https://<your-deployment>/sms` so the clinic manager's `ONCALL +1...` texts reach `RotaDesk`.

## API Reference

| Route | Method | Body / Query | Returns |
|-------|--------|--------------|---------|
| `/` | `GET` | — | Relay chat page (Path B). `?patient=maya-481` sets the handle. |
| `/widget` | `GET` | — | Widget page (Path A) embedding `<telnyx-ai-agent text-only>`. |
| `/chat` | `POST` | `{ patientId, text, conversationId? }` | `{ patientId, content, conversationId, triage, pageSent, officeHours, redFlag }` |
| `/conversation` | `POST` | `{ patientId, conversationId }` | `{ patientId, conversationId, ingested, triage, pageSent }` — ingests the widget transcript (chart + page guard). |
| `/sms` | `POST` | Telnyx `message.received` webhook | `{ received: true, rota? , replied? }` — `ONCALL <number>` updates the rota; `PATIENT <handle> <text>` chats and replies. |
| `/report` | `GET` | `?day=YYYY-MM-DD` | Clinic-wide `{ day, chats, pages, selfCare, appointments, pageOnCall }` |
| `/handoff` | `POST` | — | Triggers the daily handoff SMS and returns the same clinic report. |

**Actor RPC surface.** `NightNurse.chat(input)`, `NightNurse.ingestConversation({ conversationId })` (widget-path transcript ingest), and `NightNurse.report(day)` (per-patient ledger); `RotaDesk.current()` and `RotaDesk.setNumber({ number, updatedBy })`; `ClinicDesk.report(day)`, `ClinicDesk.dailyHandoff()`, and `ClinicDesk.arm()` (registers the 24-hour `every` schedule).

**Chart schema.** `patient_chart(patient_id, field, value, updated_at)` with `field` values like `symptom:chest_tightness`, `med:metformin`, `allergy:penicillin`, `redflag`, `pregnancy_weeks`. `sessions(patient_id, day, verdict, created_at)` and `pages(patient_id, day, to_number, summary, created_at)` back the reports; `rota(id, number, updated_by, updated_at)` holds the single live on-call number.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `NIGHT_NURSE_ASSISTANT_ID is not configured` | Env var missing or `/widget` hit before setup | Run `scripts/setup_assistant.sh` and set the returned id in `.env`. |
| Widget shows a connection error | Assistant missing `telephony_settings.supports_unauthenticated_web_calls` | Re-create the assistant with `scripts/setup_assistant.sh` (it sets the flag) or enable it in the portal. |
| Replies never page | Assistant instructions don't end with `TRIAGE: page-on-call` | Re-create the assistant with the setup script; the actor treats a missing suffix as `appointment` (safe default). |
| `invalid signature` on `/sms` | `TELNYX_PUBLIC_KEY` missing in live mode, or clock skew > 5 min | Set the public key from the portal; ensure the host clock is synced. |
| Page goes to the old number | Rota row not updated | Text `ONCALL +1XXXXXXXXXX` to the demo number; confirm the `rota` row in `CLINIC_DB`. |
| Double page after restart | `pageSent` reset | `pageSent` lives in actor state — do not clear state between turns; the guard is durable by design. |
| No handoff SMS | `DAY_TEAM_E164` unset | Set it; the actor logs a warning and skips the SMS otherwise. |
| `FROM_E164 must be an E.164 number in live mode` | Demo mode off without a sender | Set `FROM_E164` to a Telnyx-owned number or flip `DEMO_MODE=true`. |

## Agent Discovery

- Agent signup and onboarding: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- Telnyx AI agent examples: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- Machine-readable index: [llms.txt](https://developers.telnyx.com/llms.txt)

## Related Examples

- `edge-compute-statefulactor` — the Agent SDK reference this sample builds on.
- `chat-with-ai-assistant` — single-request Assistant Chat script (stateless baseline).
- `ai-assistant-web-chat` — the `<telnyx-ai-agent>` widget embed on its own.
- `sms-inbound-webhook` — Ed25519-verified inbound message handling.

## Resources

- Web chat without voice: [developers.telnyx.com/docs/inference/ai-assistants/web-chat](https://developers.telnyx.com/docs/inference/ai-assistants/web-chat)
- Assistant Chat API: [developers.telnyx.com/api-reference/assistants/assistant-chat](https://developers.telnyx.com/api-reference/assistants/assistant-chat)
- Get conversation messages: [developers.telnyx.com/api-reference/conversations/get-conversation-messages](https://developers.telnyx.com/api-reference/conversations/get-conversation-messages)
- Create a conversation: [developers.telnyx.com/api-reference/conversations/create-a-conversation](https://developers.telnyx.com/api-reference/conversations/create-a-conversation)
- Agent SDK: [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- Messaging product page: [telnyx.com/products/sms-api](https://telnyx.com/products/sms-api)
- Pricing: [telnyx.com/pricing](https://telnyx.com/pricing)
