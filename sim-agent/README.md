---
name: sim-agent
title: "SIMAgent — The Actor IS the SIM"
description: "A durable Telnyx Edge Agent that embodies a SIM card, tracking data usage, proactively alerting on thresholds, and auto-provisioning plan upgrades via SMS and Call Control."
language: typescript
framework: edge
telnyx_products: [Messaging, Voice, SIM, Wireless, Call Control, Agent SDK]
---

# SIMAgent — The Actor IS the SIM

A TypeScript Telnyx Edge Agent (`SIMAgent extends Agent`) that represents a single SIM card as a durable, stateful entity. It tracks data usage, wakes on threshold breaches to send proactive SMS alerts, responds to customer SMS with natural-language plan comparisons via LLM, auto-provisions upgrades through the Telnyx API, resets counters on billing cycle boundaries, and answers inbound customer calls with full usage history.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — programmable SMS, Voice, Call Control, and Wireless SIM management exposed through a single API surface and an Edge runtime where durable agents can live close to the data plane. By binding SMS, Voice, and SIM provisioning into one agent entity, SIMAgent turns the SIM card itself into an autonomous communication actor rather than a passive endpoint.

## Telnyx API Endpoints Used

| Product | Endpoint / Method | Purpose |
|---------|-------------------|---------|
| Messaging | `this.env.TELNYX.messages.send()` | Proactive threshold alerts and upgrade confirmations |
| Wireless | `this.env.TELNYX.simCards.update()` | Auto-provisioning data-limit upgrades on the SIM |
| Inference | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Natural-language plan comparison and SMS Q&A |
| Voice / Call Control | `POST /v2/calls/{id}/actions/answer`, `.../actions/speak` | Answering inbound customer calls with usage context |
| Webhooks | `telnyx.webhooks.unwrap()` | Verifying Ed25519 signatures on inbound webhooks (live mode) |
| Agent SDK | `this.every()`, `this.schedule()` | Billing-cycle resets and recurring threshold checks |
| Agent SDK | `this.getState()` / `this.setState()` | Durable usage counters, plan, and alert state |
| Agent SDK | `this.messages` / `this.events` | Conversation log and replayable progress events |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Telnyx Edge Runtime                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SIMAgent("sim-abc123")  extends  Agent                │  │
│  │  ────────────────────────────────────────────────      │  │
│  │  State: usage, plan, alerts, history (durable)         │  │
│  │  Schedule: every(1h) → threshold check                 │  │
│  │  Schedule: every(30d) → billing cycle reset            │  │
│  │  Messages/events: durable logs per actor               │  │
│  │  LLM: this.env.TELNYX.ai.openai.chat.createCompletion()│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │  [telnyx]    │   │  [telnyx]    │   │  [telnyx]        │ │
│  │  binding     │   │  binding     │   │  binding         │ │
│  │  SMS         │   │  Voice       │   │  Wireless SIM    │ │
│  │  (Messaging) │   │  (Call Ctrl) │   │  (Provisioning)  │ │
│  └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘ │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │  Telnyx API  │   │  Telnyx API  │   │  Telnyx API      │ │
│  │  /messages   │   │  /calls      │   │  /sim_cards      │ │
│  └──────────────┘   └──────────────┘   └──────────────────┘ │
│                                                              │
│  ┌──────────────┐                                           │
│  │  Webhooks    │                                           │
│  │  (Ed25519)   │                                           │
│  │  /webhooks/* │                                           │
│  └──────────────┘                                           │
└──────────────────────────────────────────────────────────────┘

Data flow:
  1. Telnyx usage webhook → /webhooks/usage → update durable usage state
  2. Agent schedule wakes → getState() → if usage ≥ 80% → SMS via [telnyx] binding
  3. Customer SMS → webhook → LLM plan comparison → SMS response
  4. Customer "upgrade" → TELNYX.simCards.update() → SMS confirmation
  5. Billing cycle reset → schedule → state reset → SMS summary
  6. Customer call → Call Control → agent usage history → text-to-speech
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | API key for Call Control actions in live mode | Telnyx Portal → API Keys |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes (live)** | Ed25519 public key for webhook signature verification | Telnyx Portal → Credentials |
| `TELNYX_SMS_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Telnyx phone number used as the SMS sender | Telnyx Portal → Numbers |
| `DEMO_MODE` | `boolean` | `true` | no | When `true`, no real SMS/calls/SIM updates are sent; actions are simulated | Set locally |
| `USAGE_CHECK_SECONDS` | `number` | `3600` | no | Interval between threshold checks (seconds) | Set locally |
| `BILLING_CYCLE_SECONDS` | `number` | `2592000` | no | Billing cycle length (seconds, default 30 days) | Set locally |

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-agent

# 2. Copy the example env file
cp .env.example .env
# Edit .env and fill in your Telnyx API key, public key, and sender number

# 3. Install dependencies
npm install

# 4. Typecheck and build
npm run typecheck && npm run build

# 5. Start the agent locally (telnyx-edge dev)
npm start

# 6. Run the smoke test (self-contained; exercises the demo flow)
npm run smoke
```

The agent starts in **demo mode** by default (`DEMO_MODE=true`). In demo mode, all SMS sends, call actions, and SIM provisioning calls are simulated and logged — no real charges are incurred. To switch to **live mode**, set `DEMO_MODE=false` in `.env` and restart. See `GUIDE.md` for the full demo-vs-live walkthrough.

## API Reference

See [`API.md`](./API.md) for the typed endpoint reference covering:

- `POST /api/sim` — Initialize (or re-provision) the agent for a SIM
- `POST /api/usage` — Record a usage delta against a SIM
- `GET /api/sim` — Retrieve current SIM agent state and schedules
- `POST /api/demo` — Run the full demo flow end to end
- `POST /webhooks/usage` — Telnyx data-usage webhook ingest
- `POST /webhooks/sms` — Inbound customer SMS (Ed25519 verified in live mode)
- `POST /webhooks/call` — Inbound call with usage-history text-to-speech
- `GET /health` — Health check endpoint

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Webhook signature verification fails | `TELNYX_PUBLIC_KEY` is wrong or missing | Copy the Ed25519 public key from the Telnyx Portal → Credentials; live mode requires it |
| SMS not received in demo mode | Demo mode simulates sends | Check the agent events log for `sms.sent.demo` entries |
| Plan comparison returns canned text | Inference call failed | Verify the model name (e.g. `zai-org/GLM-5.2`) and that the `[telnyx]` binding is declared in telnyx.toml |
| SIM upgrade fails in live mode | SIM ID is incorrect or SIM is not active | Confirm the SIM ID in Telnyx Portal → SIMs; the agent calls `POST /v2/sim_cards/{id}` |
| Agent schedule not firing | Edge runtime cold start | Schedules are durable and re-armed on activation; check the `usage-check` / `billing-cycle` task entries |
| Call Control answers but no audio | Missing Call Control app or webhook URL | Ensure `TELNYX_API_KEY` is set and the call webhook points at `/webhooks/call` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent with Telnyx
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Agent SDK and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable Telnyx API documentation for LLMs

## Related Examples

- [`network-incident-agent`](../network-incident-agent/) — Durable incident actor with proactive SMS, Call Control, and scheduling
- [`edge-cron-scheduler`](../edge-cron-scheduler/) — Durable `every()` / `schedule()` patterns on the Agent SDK
- [`agent-with-tool-calling`](../agent-with-tool-calling/) — LLM tool calling with demo-mode SMS transport
- [`conference-agent-mediator`](../conference-agent-mediator/) — Inference and Call Control via the `[telnyx]` binding

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx SDK (TypeScript)](https://github.com/team-telnyx/telnyx-node)
- [Telnyx Messaging Product Page](https://telnyx.com/messaging)
- [Telnyx Voice & Call Control](https://telnyx.com/voice)
- [Telnyx Wireless & SIM](https://telnyx.com/wireless)
- [Telnyx Pricing](https://telnyx.com/pricing)
