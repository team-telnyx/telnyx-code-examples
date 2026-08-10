---
name: edge-customer-agent
title: "Customer Agent — The Actor IS the Entity"
description: "A durable Entity Agent on Telnyx Edge Compute. One actor per customer phone number, surviving across days, calls, SMS messages, and actor evictions. The AI Assistant is the reasoning harness inside; the agent owns the durable state."
language: typescript
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, Voice, Messaging, AI Assistants, AI Inference]
integrations: [Salesforce]
channel: [voice, sms]
---

# Customer Agent — The Actor IS the Entity

A durable **Entity Agent** on Telnyx Edge Compute. One actor per customer, keyed by E.164 phone number, surviving across days, calls, SMS messages, and actor evictions. The AI Assistant is the reasoning/voice harness **inside** the agent; the Agent SDK owns the durable entity.

**Runs on [Telnyx Edge Compute](https://developers.telnyx.com/docs/edge-compute)** with the [Agent SDK](https://developers.telnyx.com/docs/agent-sdk) — deploy with `telnyx-edge ship`.

> **Key insight** (Ian Reither, Aug 10): *"The Assistant isn't the durable object. Ian is."* The actor IS the customer — not a conversation, not a session. A durable entity that lives across channels (voice/SMS/WhatsApp), across days, across interactions. No external state machine. No queue infrastructure. No context reconstruction.

## Telnyx API Endpoints Used

- **Agent SDK**: `Agent<Env, State>` extends `StatefulActor` — [Docs](https://developers.telnyx.com/docs/agent-sdk)
- **Edge Compute**: `telnyx-edge ship` — [Docs](https://developers.telnyx.com/docs/edge-compute)
- **Call Control**: Inbound call webhooks, TeXML — [API reference](https://developers.telnyx.com/api/call-control)
- **Messaging**: Send/receive SMS — [API reference](https://developers.telnyx.com/api/messaging)
- **AI Assistants**: Voice AI on inbound calls — [Docs](https://developers.telnyx.com/ai-assistants)
- **AI Inference**: Telnyx Inference (OpenAI-compatible) for LLM reasoning — [Docs](https://developers.telnyx.com/api/ai)

## Architecture

```
                        ┌─ Webhooks ─────────────────────────────────┐
                        │                                            │
  Inbound Call           │   POST /webhooks/voice                     │
  ──────────────────────►│   POST /webhooks/call-ended                │
  Inbound SMS            │   POST /webhooks/messaging                 │
  ──────────────────────►│   POST /webhooks/salesforce                │
  Salesforce Update      │   POST /hitl/reply                         │
  ──────────────────────►│                                            │
  Human Reply            └──────────────────┬─────────────────────────┘
  ──────────────────────►                     │
                                              ▼
                                  ┌────────────────────────┐
                                  │  fetch handler         │
                                  │  (src/index.ts)        │
                                  │  routes by URL path    │
                                  └───────────┬────────────┘
                                              │ env.AGENT.idFromName(phone)
                                              ▼
                                  ┌────────────────────────┐
                                  │  CustomerAgent actor   │
                                  │  (durable entity)      │
                                  │                        │
                                  │  ┌──────────────────┐  │
                                  │  │ CustomerState    │  │ ← survives days,
                                  │  │  - name          │  │   calls, SMS,
                                  │  │  - history       │  │   evictions
                                  │  │  - shipments     │  │
                                  │  │  - escalation    │  │
                                  │  └──────────────────┘  │
                                  │                        │
                                  │  ┌──────────────────┐  │
                                  │  │ AI Assistant     │  │ ← reasoning
                                  │  │ (Telnyx Inference)│  │   harness inside
                                  │  └──────────────────┘  │
                                  │                        │
                                  │  ┌──────────────────┐  │
                                  │  │ this.messages    │  │ ← MessageLog
                                  │  │ (conversation)   │  │
                                  │  └──────────────────┘  │
                                  │                        │
                                  │  ┌──────────────────┐  │
                                  │  │ schedule()        │  │ ← self-waking
                                  │  │ queue()           │  │   3-day timers
                                  │  │ every()           │  │
                                  │  └──────────────────┘  │
                                  └────────────────────────┘
```

## Prerequisites

- [Telnyx Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases) (`telnyx-edge`)
- A [Telnyx account](https://portal.telnyx.com/sign-up)
- A [Telnyx AI Assistant](https://portal.telnyx.com/ai-assistants) (for inbound voice)
- A Telnyx phone number with messaging + voice enabled

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env
# Edit .env — set TELNYX_API_KEY, TELNYX_AI_ASSISTANT_ID, TELNYX_FROM_NUMBER

# 3. Run locally
npm start

# 4. Deploy to Edge Compute
telnyx-edge auth login
telnyx-edge secrets add TELNYX_API_KEY "KEYxxxx"
telnyx-edge secrets add TELNYX_AI_ASSISTANT_ID "assistant-xxxx"
telnyx-edge secrets add TELNYX_FROM_NUMBER "+13125550100"
telnyx-edge ship
```

> **No API key?** The LLM client falls back to a deterministic stub so the sample runs end-to-end without `TELNYX_API_KEY`. Set `USE_MOCK_SALESFORCE=true` (default) to skip real Salesforce calls too.

## Project Structure

```
edge-customer-agent-typescript/
├── telnyx.toml              # Agent SDK manifest ([[actors]], [telnyx], [[secrets]])
├── package.json             # ESM, @telnyx/edge-runtime dep
├── tsconfig.json            # TypeScript config
├── .env.example             # Environment variables
├── src/
│   ├── index.ts             # fetch handler — webhook router (front door)
│   ├── customer-agent.ts    # CustomerAgent extends Agent<Env, CustomerState>
│   ├── state.ts             # CustomerState interface, initialCustomerState()
│   ├── llm.ts               # Telnyx Inference LLM client with stub fallback
│   ├── salesforce.ts         # Salesforce client with mockable seam
│   ├── voice.ts             # TeXML builders + Call Control commands
│   └── messaging.ts         # TelnyxBinding types + SMS helpers
├── README.md
├── API.md                   # Typed endpoint reference
└── GUIDE.md                 # Entity Agent walkthrough (AC1-AC8)
```

## How It Works

The **Entity Agent pattern** flips the conventional architecture on its head. Instead of the AI Assistant being the durable object (with state stored in Redis, a database, or session storage), the **actor IS the durable entity** — and the Assistant is the reasoning harness *inside* it.

### The 8 acceptance criteria (DEV-839)

| AC | What | How |
|----|------|-----|
| AC1 | CustomerAgent actor named after the customer (E.164) | `env.AGENT.idFromName("+13125550100")` |
| AC2 | Inbound call → Agent answers via AI Assistant | `handleCall()` returns TeXML with `<AIAssistant>` |
| AC3 | Hangup → Agent sends SMS follow-up | `onCallEnded()` → `queue("sendFollowupSMS")` |
| AC4 | SMS response next day → same agent, full context | `handleSMS()` reads `this.messages` + `this.getState()` |
| AC5 | Escalation to human, wait, then resume | `escalateToHuman()` → `resumeEscalation(replyText)` |
| AC6 | 3-day timer → agent wakes itself to check shipment | `this.schedule(3*24*3600, "checkShipmentStatus")` |
| AC7 | Salesforce webhook → agent updates + proactive SMS | `ingestSalesforceUpdate()` → `env.TELNYX.messages.send()` |
| AC8 | Second call from Ian → no context reconstruction | `handleCall()` reads `this.getState()` — full history already there |

### Addressing: one actor per customer

The actor is addressed by E.164 phone number via `idFromName()`. When Ian calls `+13125550100` today, the same actor instance wakes up that handled his call yesterday. State survives actor evictions because it's stored in the durable object's storage, not in memory.

### Self-waking via `schedule()`

The agent doesn't need an external cron job to check shipment status in 3 days. It calls `this.schedule(THREE_DAYS_SECONDS, "checkShipmentStatus", payload)` — the Agent SDK's built-in scheduler wakes the actor at the appointed time. No infrastructure required.

### The `[telnyx]` binding

A single `[telnyx]` section in `telnyx.toml` exposes the standard Telnyx SDK client as `this.env.TELNYX`:
- `this.env.TELNYX.messages.send()` — send SMS
- `this.env.TELNYX.ai.openai.chat.createCompletion()` — Telnyx Inference (OpenAI-compatible)

### Human-in-the-loop

When the agent escalates, it sets `escalation_pending: true` in state and waits. When a human replies (via `POST /hitl/reply`), `resumeEscalation()` sends the reply to the customer on their preferred channel and clears the escalation state.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. The Agent SDK extends that to durable entities:

- **Single-vendor voice stack** — Call Control, AI Assistants, TeXML, and recording from one API. No multi-vendor coordination.
- **Agent SDK = durable entities on Edge Compute** — one actor per customer, surviving days/evictions, with built-in scheduling and message logging. No Redis, no queue infrastructure, no context reconstruction.
- **`[telnyx]` binding = the full Telnyx SDK inside the actor** — `this.env.TELNYX.messages.send()`, `this.env.TELNYX.ai.openai.chat.createCompletion()`. No separate API client setup.
- **AI Inference is OpenAI-compatible** — `baseURL = "https://api.telnyx.com/v2/ai/openai"`, model = `zai-org/GLM-5.2`. Drop in any OpenAI-compatible client.
- **Self-waking actors** — `schedule()` / `every()` / `queue()` built into the SDK. No external cron, no queue service, no lambda timer hack.

## Environment Variables

| Variable | Type | Required | Description | How to set |
|----------|------|----------|-------------|------------|
| `TELNYX_API_KEY` | `string` | **yes** | Telnyx API key for messaging + inference | `telnyx-edge secrets add` |
| `TELNYX_AI_ASSISTANT_ID` | `string` | **yes** | AI Assistant ID for inbound voice | `telnyx-edge secrets add` |
| `TELNYX_FROM_NUMBER` | `string` | **yes** | Telnyx phone number for outbound SMS | `telnyx-edge secrets add` |
| `USE_MOCK_SALESFORCE` | `string` | no | `"true"` (default) = mock SF; `"false"` = hit real SF | `.env` or `secrets` |
| `SALESFORCE_CLIENT_ID` | `string` | no | Salesforce OAuth client ID (if not mocking) | `telnyx-edge secrets add` |
| `SALESFORCE_CLIENT_SECRET` | `string` | no | Salesforce OAuth client secret | `telnyx-edge secrets add` |
| `SALESFORCE_USERNAME` | `string` | no | Salesforce username | `telnyx-edge secrets add` |
| `SALESFORCE_PASSWORD` | `string` | no | Salesforce password | `telnyx-edge secrets add` |
| `SALESFORCE_TOKEN` | `string` | no | Salesforce security token | `telnyx-edge secrets add` |

## Webhook Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Telnyx inbound call webhook → `handleCall()` |
| `POST` | `/webhooks/call-ended` | Telnyx call-ended webhook → `onCallEnded()` |
| `POST` | `/webhooks/messaging` | Telnyx messaging webhook → `handleSMS()` |
| `POST` | `/webhooks/salesforce` | Salesforce status change → `ingestSalesforceUpdate()` |
| `POST` | `/hitl/reply` | Human-in-the-loop reply → `resumeEscalation()` |
| `GET` | `/` | API descriptor |
| `GET` | `/health/liveness` | Liveness probe |
| `GET` | `/health/readiness` | Readiness probe |

See [API.md](API.md) for the full typed endpoint reference and [GUIDE.md](GUIDE.md) for the Entity Agent walkthrough.

## Testing

**Test locally before deploying:**

```bash
# Simulate an inbound call webhook
curl -X POST http://localhost:8080/webhooks/voice \
  -H "Content-Type: application/json" \
  -d '{"data":{"payload":{"call_control_id":"ccc-123","from":"+13125550100","to":"+18005551234"}}}'

# → Returns TeXML with <AIAssistant> element

# Simulate an inbound SMS
curl -X POST http://localhost:8080/webhooks/messaging \
  -H "Content-Type: application/json" \
  -d '{"data":{"payload":{"from":"+13125550100","to":"+18005551234","text":"Where is my order?"}}}'

# → Returns {"ok": true} (agent sends SMS reply asynchronously)

# Simulate a Salesforce update
curl -X POST http://localhost:8080/webhooks/salesforce \
  -H "Content-Type: application/json" \
  -d '{"customer_phone_e164":"+13125550100","salesforce_id":"SF-001","status":"shipped","tracking_number":"1Z999"}'

# → Agent sends proactive SMS to customer

# Simulate a human reply (HITL)
curl -X POST http://localhost:8080/hitl/reply \
  -H "Content-Type: application/json" \
  -d '{"phone_e164":"+13125550100","reply_text":"I authorized the refund."}'

# → Agent forwards reply to customer on preferred channel
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision a phone number
telnyx available-phone-numbers list --country US --features sms,voice
telnyx number-orders create --phone-number +13125550100

# Create an AI Assistant
telnyx ai-assistants create --name "Customer Agent" --model "zai-org/GLM-5.2"
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

## Troubleshooting

- **`TELNYX_API_KEY` not set**: The LLM client falls back to a deterministic stub so you can still exercise the flow. Set the key for real inference.
- **AI Assistant not answering**: Verify `TELNYX_AI_ASSISTANT_ID` is set and the assistant exists in your Telnyx portal. The TeXML `<AIAssistant>` element requires a valid assistant ID.
- **SMS not sending**: Check `TELNYX_FROM_NUMBER` is a number you own with messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned.
- **Webhooks not arriving**: Configure your Telnyx [Call Control Application](https://portal.telnyx.com/call-control/applications) and Messaging Profile webhook URLs to point at the deployed function (e.g. `https://<your-edge-url>/webhooks/voice`).
- **Salesforce 401s**: Set `USE_MOCK_SALESFORCE=true` to use the built-in mock. For real SF, provide all `SALESFORCE_*` credentials.
- **Actor state not persisting**: Confirm `[[actors]]` binding is in `telnyx.toml` with `binding = "AGENT"`. The actor namespace must be bound for `env.AGENT.idFromName()` to work.
- **Schedule not firing**: The Agent SDK `schedule()` requires the actor to be deployed (not just local dev). Schedules survive actor evictions but need a live Edge Compute deployment to wake.
- **Type errors in `customer-agent.ts`**: Run `npm run typecheck`. The `Agent` and related types ship in `@telnyx/edge-runtime` — ensure you have `npm install`'d.

## Related Examples

- [edge-compute-webhook-proxy-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compute-webhook-proxy-python/README.md) — Edge webhook proxy (no Agent SDK)
- [edge-ivr-ab-tester-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-ivr-ab-tester-python/README.md) — A/B test IVR at the edge
- [edge-voicemail-to-action-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voicemail-to-action-python/README.md) — Voicemail triage at the edge
- [edge-webhook-aggregator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-webhook-aggregator-python/README.md) — Multi-tenant webhook consolidation
- [omnichannel-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-receptionist-python/README.md) — Omnichannel AI receptionist (Flask-based)
- [sms-chatbot-with-conversation-memory-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-chatbot-with-conversation-memory-python/README.md) — SMS chatbot with conversation memory

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **Agent SDK docs**: [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Agent SDK Docs](https://developers.telnyx.com/docs/agent-sdk)
- [Edge Compute Docs](https://developers.telnyx.com/docs/edge-compute)
- [Edge Compute Quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Edge CLI Releases](https://github.com/team-telnyx/edge-compute/releases)
- [AI Assistants Docs](https://developers.telnyx.com/ai-assistants)
- [AI Inference API](https://developers.telnyx.com/api/ai)
