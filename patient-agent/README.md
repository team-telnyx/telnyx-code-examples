---
name: patient-agent
title: "PatientAgent — A Living Care Coordinator on Telnyx Edge"
description: "A durable agent that tracks appointments, medication adherence, and proactively checks in via SMS — the actor IS the patient."
language: typescript
framework: edge
telnyx_products: [Messaging, Voice, Agent SDK, Inference]
---

# PatientAgent — A Living Care Coordinator on Telnyx Edge

A stateful `PatientAgent` that owns a patient entity, schedules reminders, detects missed appointments, assesses symptoms via LLM, escalates to nurses, and self-wakes for follow-up check-ins — all over Telnyx SMS.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — programmable messaging, voice, and agent primitives that let you build durable, stateful actors that communicate with humans over real channels. PatientAgent leverages Telnyx Edge's Agent SDK for persistent state, `schedule()` and `every()` for proactive reminders, the Messaging API for SMS delivery, and Inference for symptom assessment — all with built-in webhook security and Ed25519 signature verification.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/messages` | POST | Send SMS reminders, check-ins, and confirmations |
| `/v2/calls` | POST | (Optional) Voice reminders for high-priority alerts |
| `/v2/webhooks` | POST (inbound) | Receive patient SMS replies and delivery status |
| `telnyx.ai.openai.chat.createCompletion` | POST | Symptom assessment and triage reasoning |
| `telnyx.messages` (SDK) | — | High-level SMS send/receive via Edge SDK |
| `telnyx.calls` (SDK) | — | High-level Call Control via Edge SDK |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Telnyx Edge Runtime                      │
│                                                              │
│  ┌──────────────┐     ┌──────────────────────────────────┐  │
│  │  PatientAgent │◄───►│  Agent SDK (persistent state)    │  │
│  │  (extends     │     │  - appointment history           │  │
│  │   Agent)      │     │  - medication schedule           │  │
│  │               │     │  - symptom log                   │  │
│  │  schedule()   │     │  - escalation status             │  │
│  │  every()      │     └──────────────────────────────────┘  │
│  │  queue()      │                                              │
│  └──────┬───────┘                                              │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────┐     ┌──────────────────────────────────┐  │
│  │  Telnyx SDK  │◄───►│  Messaging API (SMS)             │  │
│  │  telnyx.     │     │  - outbound reminders            │  │
│  │  messages    │     │  - inbound replies               │  │
│  │  calls       │     │  - delivery receipts             │  │
│  └──────┬───────┘     └──────────────────────────────────┘  │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────┐     ┌──────────────────────────────────┐  │
│  │  Inference    │◄───►│  OpenAI via TELNYX.ai            │  │
│  │  (LLM)        │     │  - symptom triage                │  │
│  │  create-      │     │  - escalation decisioning        │  │
│  │  Completion   │     └──────────────────────────────────┘  │
│  └──────┬───────┘                                              │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────┐     ┌──────────────────────────────────┐  │
│  │  EHR / FHIR   │◄───►│  Mock Appointment API            │  │
│  │  (external)   │     │  - read/write appointments       │  │
│  └──────────────┘     └──────────────────────────────────┘  │
│                                                              │
│  ┌──────────────┐                                              │
│  │  Human-in-    │                                              │
│  │  the-Loop     │                                              │
│  │  (Nurse)      │                                              │
│  │  - escalation │                                              │
│  │  - wait/resume│                                              │
│  └──────────────┘                                              │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. `PatientAgent` initializes with persistent state (appointments, meds, symptom log).
2. `schedule()` + `every()` register proactive reminders (24h before appointment, daily med check, Day 14 follow-up).
3. Telnyx Messaging API sends SMS via the Edge SDK; inbound replies arrive as webhook events.
4. Webhook handler verifies Ed25519 signature, extracts `data.payload`, and dispatches to the agent.
5. LLM (via `this.env.TELNYX.ai.openai.chat.createCompletion`) assesses symptoms from patient replies.
6. If escalation is needed, the agent queues a nurse notification and waits for human response.
7. Nurse reply is relayed to the patient; follow-up appointment is scheduled via the EHR API.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PHONE_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Sender phone number for SMS | [Telnyx Portal](https://portal.telnyx.com) |
| `PATIENT_PHONE_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Patient's phone number for demo | — |
| `EHR_API_BASE_URL` | `string` | `https://ehr-mock.example.com` | no | Base URL for mock EHR/FHIR API | — |
| `OPENAI_API_KEY` | `string` | `sk-your-openai-key-here` | no | For LLM symptom assessment (if not using TELNYX.ai) | [OpenAI](https://platform.openai.com) |
| `DEMO_MODE` | `boolean` | `true` | no | If `true`, logs SMS instead of sending real messages | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/patient-agent

# Copy environment template
cp .env.example .env

# Edit .env and fill in your Telnyx API key and phone numbers
# TELNYX_API_KEY=your_telnyx_api_key_here
# TELNYX_PHONE_NUMBER=+1555XXXXXXXX
# PATIENT_PHONE_NUMBER=+1555XXXXXXXX
# DEMO_MODE=true

# Install dependencies
npm install

# Run locally (demo mode by default)
npm run dev

# Run smoke test
npm run smoke-test
```

The agent starts in **demo mode** by default (`DEMO_MODE=true`). In demo mode, all SMS messages are logged to the console instead of being sent via the Telnyx API. To switch to **live mode**, set `DEMO_MODE=false` in your `.env` file.

## API Reference

See [`API.md`](./API.md) for the full typed endpoint reference, including:

- `POST /webhooks/telnyx` — Inbound SMS webhook handler (Ed25519 verified)
- `POST /webhooks/telnyx/status` — Delivery status webhook handler
- `GET /agent/:patientId` — Retrieve patient agent state
- `POST /agent/:patientId/remind` — Trigger a manual reminder
- `POST /agent/:patientId/check-in` — Trigger a follow-up check-in

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Error: Invalid Ed25519 signature` | Webhook signature mismatch | Ensure `TELNYX_API_KEY` is correct and webhook URL matches Telnyx portal |
| `Error: Missing TELNYX_PHONE_NUMBER` | Env var not set | Copy `.env.example` to `.env` and set `TELNYX_PHONE_NUMBER` |
| `Error: Cannot find module '@telnyx/edge-sdk'` | Dependencies not installed | Run `npm install` in the project root |
| `SMS not received (demo mode)` | Expected behavior | In demo mode, SMS is logged to console — check terminal output |
| `LLM assessment failed` | OpenAI API key missing or invalid | Set `OPENAI_API_KEY` in `.env` or ensure `TELNYX.ai` is configured |
| `Appointment not rescheduled` | EHR API unreachable | Verify `EHR_API_BASE_URL` is accessible or use mock mode |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent and get API credentials
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Agent SDK source, examples, and community
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for LLM agents

## Related Examples

- [`sms-notification-agent`](../sms-notification-agent/) — Basic SMS notification agent
- [`voice-call-agent`](../voice-call-agent/) — Voice Call Control with IVR
- [`appointment-reminder`](../appointment-reminder/) — Simple appointment reminder system
- [`symptom-triage-bot`](../symptom-triage-bot/) — LLM-powered symptom triage chatbot

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com) — Full API documentation and guides
- [Telnyx API Reference](https://developers.telnyx.com/api) — REST API endpoint reference
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk) — TypeScript SDK for Edge Runtime
- [Telnyx Messaging Product Page](https://telnyx.com/messaging) — SMS/MMS product details
- [Telnyx Voice Product Page](https://telnyx.com/voice) — Voice and Call Control product details
- [Telnyx Pricing](https://telnyx.com/pricing) — Transparent pay-as-you-go pricing
