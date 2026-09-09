---
name: edge-event-microsite
title: "Event Microsite That Takes Calls"
description: "Event microsite + AI concierge on Telnyx Edge Compute — one KV store powers the site, the SMS/WhatsApp concierge, lead qualification, in-browser voice AI, feedback transcription, and the sponsor report."
language: nodejs
framework: telnyx-edge
telnyx_products: [Edge Compute, KV, Messaging, AI Inference, Voice AI, Email]
---

# Event Microsite That Takes Calls

Event microsite + AI concierge on Telnyx Edge Compute — one KV store powers the site, the SMS/WhatsApp concierge, lead qualification, in-browser voice AI, feedback transcription, and the sponsor report. No ngrok, no external server — runs at `*.telnyxcompute.com`.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. This example shows why that matters: the website, the text concierge, the voice assistant, and the analytics all read the **same Telnyx KV namespace**, so the site and every agent can never drift apart — and it all deploys as one Edge Compute function.

## Telnyx API Endpoints Used

| Telnyx Product | Method / Binding | Purpose |
|----------------|------------------|---------|
| Edge Compute Functions | `telnyx-edge ship` (TypeScript) | Hosts the microsite, APIs, and webhooks at a public URL |
| KV | `[storage.kv.EVENTS]` binding (`env.EVENTS`) | Single source of truth: event data, attendees, leads, feedback, assistant id |
| AI Inference | `env.TELNYX.ai.openai.chat.createCompletion` (zero-credential) | Concierge Q&A, lead extraction, feedback summaries |
| Messaging (SMS) | `POST /v2/messages` | Concierge replies, schedule broadcasts, hot-lead routing |
| Messaging (WhatsApp) | `POST /v2/messages` | Same flows over WhatsApp |
| Voice AI (browser) | `@telnyx/ai-agent-lib` (WebRTC, anonymous login) | Talk to the concierge in the browser — no dialing, no credentials |
| AI Assistants | `POST /v2/ai/assistants` | Provisions the voice agent, wired with a webhook tool backed by KV |
| Speech-to-text | `POST /v2/ai/audio/transcriptions` (Whisper) | Transcribes spoken feedback recordings |
| Email | `POST /v2/email_messages` | Emails the sponsor report to the organizer |
| Webhook security | Ed25519 signature verification | Verifies inbound SMS/WhatsApp and assistant tool calls |

## Architecture

```
                        ┌───────────────────────────────────────────────┐
                        │      Edge Function (TypeScript, one deploy)   │
                        │      *.telnyxcompute.com                      │
                        │                                               │
   Attendee browser ───►│  GET /            microsite HTML from KV      │
                        │  GET /voice       in-browser voice (WebRTC)   │
                        │  GET /api/*       JSON APIs from KV           │
                        │  POST /api/leads  qualify + route hot leads   │
                        │  POST /api/feedback  Whisper + summary        │
                        │  POST /api/broadcast  SMS + WhatsApp blast    │
                        │  POST /api/email-report  sponsor report email │
                        │  POST /tools/lookup  ← assistant webhook tool │
   SMS / WhatsApp  ────►│  POST /webhook/sms, /webhook/whatsapp         │
                        │          │ (Ed25519-verified)                 │
                        └────────────┬──────────────────────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
                    │        Telnyx KV namespace       │
                    │  event/data · attendee/* ·       │
                    │  lead/* · feedback/* ·           │
                    │  assistant/id                    │
                    └────────────────┬─────────────────┘
                                     │ same data, three consumers:
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
      website render          SMS/WhatsApp             voice assistant
      (server-rendered)       concierge (Inference)    (webhook tool → KV)
```

The "never drift" guarantee: every surface answers from the same KV keys. Change the schedule once, and the site, the text concierge, and the browser voice agent all reflect it immediately.

## Environment Variables

| Variable | Where it lives | Required | Description |
|----------|----------------|----------|-------------|
| `TELNYX_API_KEY` | Secret (auto-injected by `[telnyx]` binding) | Yes | Telnyx API key for REST calls (messaging, transcription, assistants, email) |
| `TELNYX_PUBLIC_KEY` | Secret (`telnyx-edge secrets add`) | Yes | Org public key for Ed25519 webhook verification |
| `EMAIL_TO` | Secret (`telnyx-edge secrets add`) | For email | Organizer email for the sponsor report (shared sending domain delivers to the account's verified email) |
| `AI_MODEL` | `telnyx.toml` `[env_vars]` | No | Chat model for inference (default `meta-llama/Llama-3.3-70B-Instruct`) |
| `ASSISTANT_MODEL` | `telnyx.toml` `[env_vars]` | No | Model for the voice AI Assistant (default `moonshotai/Kimi-K2.6` — the assistant-compatible set differs from chat) |
| `TRANSCRIBE_MODEL` | `telnyx.toml` `[env_vars]` | No | Whisper model (default `distil-whisper/distil-large-v2`) |
| `TELNYX_SMS_FROM` | `telnyx.toml` `[env_vars]` | Yes | SMS-enabled sender number, assigned to a messaging profile |
| `TELNYX_WHATSAPP_FROM` | `telnyx.toml` `[env_vars]` | Yes | WhatsApp sender number |
| `TELNYX_SALES_REP_PHONE` | `telnyx.toml` `[env_vars]` | Yes | Where hot-lead SMS alerts go |
| `EMAIL_FROM` | `telnyx.toml` `[env_vars]` | No | Sender address (default `onboarding@mail.telnyx.com` shared domain) |

> Agent / CLI access — provision the resources this example uses:
>
> ```bash
> # Secrets (org-scoped, injected at runtime)
> telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
> telnyx-edge secrets add EMAIL_TO "you@example.com"
>
> # KV namespace
> telnyx-edge storage kv create --name edge-event-microsite-data
>
> # Phone number + messaging profile (SMS/WhatsApp sender)
> telnyx number-orders create --phone-numbers["+1628XXXXXXX"] --connection-id ""  # or buy in the Portal
> telnyx messaging-profiles create --name "edge-event-microsite" \
>   --webhook-url "https://<your-func>.telnyxcompute.com/webhook/sms"
> telnyx messaging-phone-numbers update <number-id> --messaging-profile-id <profile-id>
> ```

## Setup

```bash
# 1. Clone and enter the example
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-event-microsite

# 2. Install dependencies
npm install

# 3. Authenticate the Edge CLI
telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>

# 4. Create the KV namespace, then paste its id into telnyx.toml
telnyx-edge storage kv create --name edge-event-microsite-data

# 5. Add the webhook-verification secret (org public key)
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"

# 6. Deploy
telnyx-edge ship
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Function identity is created automatically on first ship; to scaffold manually:
telnyx-edge new-func -l ts -n edge-event-microsite

# KV namespace
telnyx-edge storage kv create --name edge-event-microsite-data
# → paste the returned KV ID into telnyx.toml [storage.kv.EVENTS] id

# Secrets (org-scoped)
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
telnyx-edge secrets add EMAIL_TO "you@example.com"

# Messaging profile pointing inbound SMS/WhatsApp at the function
telnyx messaging-profiles create --name "edge-event-microsite" \
  --webhook-url "https://edge-event-microsite-<id>.telnyxcompute.com/webhook/sms"
# assign your number (find its id with `telnyx phone-numbers list`):
telnyx messaging-phone-numbers update <phone_number_id> \
  --messaging-profile-id <profile_id>

# Regenerate binding types after manifest changes
telnyx-edge types

# Deploy + verify
telnyx-edge ship
curl -sS https://edge-event-microsite-<id>.telnyxcompute.com/health/liveness
```

</details>

### 7. Provision the voice assistant (one call)

```bash
curl -X POST https://edge-event-microsite-<id>.telnyxcompute.com/api/setup-assistant
```

This creates (or updates) a Telnyx AI Assistant with a webhook tool pointing at `/tools/lookup` on this function — the voice agent reads the same KV as the website.

### 8. Use it

- Open `https://edge-event-microsite-<id>.telnyxcompute.com/` — the microsite
- Open `/voice` — talk to the concierge in the browser (no dialing)
- Text your `TELNYX_SMS_FROM` number — the concierge replies from KV
- `POST /api/broadcast` — SMS + WhatsApp a schedule change to registered attendees
- `POST /api/email-report` — email the sponsor report to `EMAIL_TO`

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-event-microsite/API.md) for the full typed reference.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Microsite HTML, server-rendered from KV |
| `GET` | `/voice` | In-browser voice concierge page (WebRTC) |
| `GET` | `/api/config` | Assistant id + event name for the voice page |
| `GET` | `/api/event` | Full event JSON from KV |
| `GET` | `/api/leads` | Captured leads (with hot-lead count) |
| `GET` | `/api/sponsor-report` | Aggregated feedback summaries |
| `POST` | `/api/leads` | Submit a structured lead; hot leads route to sales via SMS (+ email fallback) |
| `POST` | `/api/attendees` | Register a phone for schedule-change broadcasts |
| `POST` | `/api/broadcast` | SMS + WhatsApp a schedule change to all opted-in attendees |
| `POST` | `/api/feedback` | Spoken feedback: audio upload (Whisper) or direct transcript; summarized and stored |
| `POST` | `/api/email-report` | Email the sponsor report to the organizer |
| `POST` | `/api/setup-assistant` | Provision/update the voice AI Assistant + webhook tool |
| `POST` | `/tools/lookup` | Assistant webhook tool — returns live event data from KV (Ed25519-verified) |
| `POST` | `/webhook/sms` | Inbound SMS → concierge (Ed25519-verified) |
| `POST` | `/webhook/whatsapp` | Inbound WhatsApp → concierge (Ed25519-verified) |
| `GET` | `/health/liveness`, `/health/readiness` | Platform health probes |

## Troubleshooting

- **`function error: env KV get(...) failed: HTTP 400 ... Invalid key format`** — KV keys only allow `a-z A-Z 0-9 - _ / = .`. Phone numbers are encoded with `+` as `=`; keep that mapping if you add new key shapes.
- **SMS sends fail with `40305 Invalid 'from' address`** — the sender number must be assigned to a messaging profile: `PATCH /v2/messaging_phone_numbers/<number_id>` with `{"messaging_profile_id": "<profile_id>"}`.
- **`10027 Model ... is not available for AI Assistants`** — the assistant-compatible model set is smaller than the chat set. Keep `ASSISTANT_MODEL` (default `moonshotai/Kimi-K2.6`) separate from `AI_MODEL`.
- **Webhook handlers return 400/401** — Telnyx signs webhooks with Ed25519 (`Telnyx-Signature-Ed25519` + `Telnyx-Timestamp`, signed payload `"{ts}|{body}"`). Make sure `TELNYX_PUBLIC_KEY` is set as a secret and clocks are within 5 minutes.
- **Voice page says "Assistant not provisioned"** — run `POST /api/setup-assistant` once after deploy.
- **In-browser talk does nothing** — the browser needs microphone permission and a secure context (the `telnyxcompute.com` URL is HTTPS, so this is automatic). Check the page shows `connected` before starting a conversation.
- **Shared-domain email rejected** — `onboarding@mail.telnyx.com` can only deliver to the account's verified email. Set `EMAIL_TO` to that address, or verify your own domain for arbitrary recipients.

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

- [AI-Powered Call Router (TypeScript, Edge + Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-powered-call-router/README.md)
- [Edge URL Summarizer (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-url-summarizer/README.md)
- [Edge Robo-Call Screener (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-robo-call-screener-typescript/README.md)
- [Event Microsite (Flask, Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/event-microsite-that-takes-calls/README.md)

## Resources

- [Edge Compute Quick Start](https://developers.telnyx.com/docs/edge-compute/quick-start)
- [Edge Compute KV](https://developers.telnyx.com/docs/edge-compute/kv)
- [AI Assistants](https://developers.telnyx.com/docs/inference/ai-assistants)
- [WebRTC AI Voice Assistant (JS SDK)](https://developers.telnyx.com/docs/development/webrtc/js-sdk)
- [Send SMS](https://developers.telnyx.com/docs/messaging/sms)
- [`@telnyx/ai-agent-lib` on npm](https://www.npmjs.com/package/@telnyx/ai-agent-lib)
- [Telnyx API Reference](https://developers.telnyx.com/api-reference)
- [Edge Compute product page](https://telnyx.com/products/edge-compute)
- [Pricing](https://telnyx.com/pricing)
