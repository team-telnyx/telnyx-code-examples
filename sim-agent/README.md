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
| Messaging | `telnyx.messages.create()` | Proactive threshold alerts and upgrade confirmations |
| Messaging | `telnyx.messages.list()` | Polling inbound SMS from customers |
| Voice / Call Control | `telnyx.calls.create()` | Answering inbound customer calls with usage context |
| Voice / Call Control | `telnyx.calls.update()` | Controlling call state (answer, hangup) |
| Wireless | `telnyx.sims.update()` | Auto-provisioning plan upgrades on the SIM |
| Wireless | `telnyx.sims.get()` | Fetching current SIM plan and usage metadata |
| Webhooks | `telnyx.webhooks.unwrap()` | Verifying Ed25519 signatures on inbound SMS and usage webhooks |
| Agent SDK | `this.schedule()`, `this.every()` | Billing-cycle resets and periodic threshold checks |
| Agent SDK | `ctx.kv.get()` / `ctx.kv.put()` | Persisting usage counters and SIM state |
| Inference | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Natural-language plan comparison |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Telnyx Edge Runtime                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SIMAgent("sim-abc123")  extends  Agent                │  │
│  │  ────────────────────────────────────────────────      │  │
│  │  State: usage, plan, alerts, history                   │  │
│  │  Schedule: every(1h) → threshold check                 │  │
│  │  Schedule: every(30d) → billing cycle reset            │  │
│  │  KV: ctx.kv.get('sim:abc123:usage')                    │  │
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
│  │  /messages   │   │  /calls      │   │  /sims           │ │
│  └──────────────┘   └──────────────┘   └──────────────────┘ │
│                                                              │
│  ┌──────────────┐                                           │
│  │  Webhooks    │                                           │
│  │  (Ed25519)   │                                           │
│  │  /webhooks   │                                           │
│  └──────────────┘                                           │
└──────────────────────────────────────────────────────────────┘

Data flow:
  1. Telnyx usage webhook → /webhooks → unwrap signature → update KV usage
  2. Agent schedule wakes → reads KV → if usage ≥ 80% → SMS via telnyx binding
  3. Customer SMS → webhook → LLM plan comparison → SMS response
  4. Customer "upgrade" → telnyx.sims.update() → SMS confirmation
  5. Billing cycle reset → schedule → KV reset → SMS summary
  6. Customer call → Call Control → telnyx.calls.create() → usage history
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | Ed25519 public key for webhook signature verification | Telnyx Portal → Credentials |
| `TELNYX_PHONE_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Telnyx phone number used as SMS sender / call target | Telnyx Portal → Numbers |
| `TELNYX_SIM_ID` | `string` | `sim-abc123` | **yes** | Identifier of the SIM card this agent represents | Telnyx Portal → SIMs |
| `OPENAI_API_KEY` | `string` | `sk-your-openai-key-here` | **yes** | API key for LLM-powered plan comparison | OpenAI Platform |
| `DEMO_MODE` | `boolean` | `true` | no | When `true`, no real SMS/calls are sent; actions are logged | Set locally |

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-agent

# 2. Copy the example env file
cp .env.example .env
# Edit .env and fill in your Telnyx API key, public key, phone number, SIM ID, and OpenAI key

# 3. Install dependencies
npm install

# 4. Run locally (demo mode by default)
npm run dev

# 5. Run smoke test
npm run smoke
```

The agent starts in **demo mode** by default (`DEMO_MODE=true`). In demo mode, all SMS sends, call creations, and SIM provisioning calls are intercepted and logged — no real charges are incurred. To switch to **live mode**, set `DEMO_MODE=false` in `.env` and restart. See `GUIDE.md` for the full demo-vs-live walkthrough.

## API Reference

See [`API.md`](./API.md) for the typed endpoint reference covering:

- `POST /webhooks` — Inbound SMS and usage webhook handler (Ed25519 verified)
- `GET /health` — Health check endpoint
- `GET /agent/:simId/state` — Retrieve current SIM agent state (usage, plan, alerts)
- `POST /agent/:simId/trigger-threshold-check` — Manually trigger a threshold check
- `POST /agent/:simId/reset-billing-cycle` — Manually trigger a billing cycle reset

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Webhook signature verification fails | `TELNYX_PUBLIC_KEY` is wrong or missing | Copy the Ed25519 public key from the Telnyx Portal → Credentials |
| SMS not received in demo mode | Demo mode suppresses real sends | Check logs for `DEMO_MODE: would send SMS to ...` |
| LLM plan comparison returns empty | `OPENAI_API_KEY` is invalid or rate-limited | Verify key at platform.openai.com and check rate limits |
| SIM upgrade fails | SIM ID is incorrect or SIM is not active | Confirm `TELNYX_SIM_ID` in Telnyx Portal → SIMs |
| Agent schedule not firing | Edge runtime cold start or KV read error | Check `npm run dev` logs for KV errors |
| Call Control answers but no audio | Missing `Connection` header or webhook URL | Ensure `TELNYX_PHONE_NUMBER` is set and webhooks are configured |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent with Telnyx
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Agent SDK and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable Telnyx API documentation for LLMs

## Related Examples

- [`sms-auto-responder`](../sms-auto-responder/) — Basic SMS bot with webhook verification
- [`voice-ivr`](../voice-ivr/) — Interactive Voice Response using Call Control
- [`wireless-usage-tracker`](../wireless-usage-tracker/) — SIM data usage monitoring via webhooks
- [`agent-scheduler`](../agent-scheduler/) — Durable agent scheduling and KV patterns

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx SDK (TypeScript)](https://github.com/team-telnyx/telnyx-node)
- [Telnyx Messaging Product Page](https://telnyx.com/messaging)
- [Telnyx Voice & Call Control](https://telnyx.com/voice)
- [Telnyx Wireless & SIM](https://telnyx.com/wireless)
- [Telnyx Pricing](https://telnyx.com/pricing)
