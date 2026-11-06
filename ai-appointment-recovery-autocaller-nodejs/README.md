---
name: ai-appointment-recovery-autocaller
title: "AI Appointment Recovery Autocaller — recover the revenue a missed appointment loses"
description: "Every missed appointment is a lost revenue slot. This minimal Express server has the AI receptionist call the patient, offer real rebooking slots over voice, book the choice through a webhook tool call, and send the SMS confirmation — the patient's number is saved on file at booking time."
language: nodejs
framework: express
telnyx_products: [Voice, AI Assistants, Messaging, Numbers]
integrations: []
channel: [voice, sms]
---

# AI Appointment Recovery Autocaller — the AI receptionist calls your no-shows

A missed appointment is a lost revenue slot — the visit goes unused, and the practice has to chase it manually. Most no-shows are recoverable with one well-timed call. This example books the patient with their **number saved on file**, marks the visit missed, and has the **AI receptionist call the patient automatically**: confirm identity, apologize, offer real rebooking slots, and book the one the patient picks — via a webhook tool call back to this server — then sends the SMS confirmation. The practice gets the visit back; the staff touch nothing.

## Why Telnyx?

[AI Communications Infrastructure](https://telnyx.com/products/ai-communications-infrastructure) — voice, AI assistants, and messaging over one API. The AI receptionist dials with the patient's number on file, transcribes and reasons over the live call, and books the new slot through a tool call — one platform, one API key.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
| --- | --- |
| `POST /v2/calls` | Places the AI-assisted call to the patient's number on file |
| `POST /v2/ai/assistants` | Creates the AI receptionist (idempotent bootstrap) |
| `GET /v2/ai/assistants` | Finds the existing assistant by name |
| `POST /v2/messages` | Sends the SMS confirmation after the call |
| `POST /v2/calls/:id/actions/hangup` | Cancels the call (cancel endpoint) |

## Architecture

```
 Patient ──phone──> Telnyx Voice ──webhook──> /webhooks/voice (signature-verified)
                                        │
 AI Assistant (Ava) <──assistant config─┘
        │  speaks the rebooking options (dynamic variables)
        │  patient picks a slot
        ▼
 book_appointment tool ──POST──> /tools/book ──> validates against availability
                                                 ├─ books the slot
                                                 └─ POST /v2/messages → SMS confirmation
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `TELNYX_API_KEY` | ✅ | Your Telnyx API key from the [Mission Control portal](https://portal.telnyx.com) |
| `TELNYX_CONNECTION_ID` | ✅ | Call Control connection ID (the application that places the AI call) |
| `TELNYX_NUMBER` | ✅ | The clinic's outbound number (E.164) shown as the caller ID |
| `PUBLIC_BASE_URL` | ✅ | Public URL of this server (e.g. an ngrok/Cloudflare tunnel) — the assistant's tool webhook points here |
| `TELNYX_ASSISTANT_ID` | — | Reuse an existing AI Assistant; leave empty to bootstrap one by name |
| `TELNYX_PUBLIC_KEY` | — | Org public key (`GET /v2/public_key`) — when set, webhooks are Ed25519-verified |
| `CLINIC_NAME` | — | Clinic name spoken by the AI (default: Winderval Medical) |
| `PORT` | — | HTTP port (default: 3000) |

## Setup

```bash
# 1. Clone the repository and enter this example
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-appointment-recovery-autocaller-nodejs

# 2. Configure
cp .env.example .env
#    → set TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_NUMBER, PUBLIC_BASE_URL

# 3. Run
npm install
npm start
```

Expose the server publicly so Telnyx can reach the webhooks and the tool:

```bash
npx ngrok http 3000   # or any tunnel; copy the https URL into PUBLIC_BASE_URL
```

**Try it:**

```bash
# 1. Book the visit (number saved on file)
curl -X POST localhost:3000/appointments -H 'Content-Type: application/json' \
  -d '{"name": "Priya Nair", "phone": "+15555550123"}'

# 2. Mark it missed — the AI receptionist calls that number
curl -X POST localhost:3000/appointments/<ID>/no-show

# 3. Answer the call and pick one of the offered slots — the AI books it,
#    the SMS confirmation lands, and GET /appointments shows the new state.
```

## API Reference

Full request/response shapes in [API.md](API.md).

| Route | Description |
| --- | --- |
| `POST /appointments` | Book a visit with the patient's number on file |
| `POST /appointments/:id/no-show` | Mark missed → the AI receptionist auto-calls |
| `POST /webhooks/voice` | Telnyx call webhooks (Ed25519 signature-verified) |
| `POST /tools/book` | The `book_appointment` tool the AI calls mid-conversation |
| `GET /appointments` | Current state (masked numbers) |

## Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| `HTTP 403 ... Connection has no Outbound Profile assigned` | The Call Control app has no outbound profile | Mission Control → Voice → Programmable Fax/Web → your app → attach an Outbound Voice Profile |
| No transcript / tool call fires | `PUBLIC_BASE_URL` not reachable from the public internet | Use a public tunnel (ngrok, Cloudflare) and restart |
| `HTTP 401 invalid signature` on webhooks | Signature verification on but headers/key mismatched | Confirm `TELNYX_PUBLIC_KEY` matches your org key (`GET /v2/public_key`) |
| Call connects but the assistant is silent | Assistant disabled or missing voice | Check the assistant in Mission Control → AI → Assistants |

## Related Examples

- [ai-appointment-reminder-sms-voice-python](../ai-appointment-reminder-sms-voice-python) — appointment reminders over SMS and voice
- [ai-medical-appointment-prep-caller-python](../ai-medical-appointment-prep-caller-python) — pre-visit prep calls
- [multi-channel-appointment-confirmation-python](../multi-channel-appointment-confirmation-python) — confirmations over SMS and voice

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents
- **Agent SDK docs**: [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)

## Resources

- [Telnyx AI Assistants](https://developers.telnyx.com/docs/voice/programmable-voice-basics) — assistants, tools, dynamic variables
- [Telnyx Call Control](https://developers.telnyx.com/api/call-control) — dialing and call events
- [Webhook signature verification](https://developers.telnyx.com/docs/webhooks/verify-webhooks) — Ed25519 contract
- [Messaging API](https://developers.telnyx.com/docs/messaging) — SMS send API
