---
name: agent-sms-triage-bot
title: "Agent SMS Triage Bot"
description: "SMS triage bot on Telnyx Edge Compute + Agent SDK — classifies inbound customer SMS by topic (billing/support/sales) via LLM and routes to the right queue using a durable route table. Zero-credential SMS and inference."
language: nodejs
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, Messaging, AI Inference]
---

# Agent SMS Triage Bot

SMS triage bot on Telnyx Edge Compute + Agent SDK — classifies inbound customer messages by topic (billing, support, sales, general) via LLM inference, looks up the destination queue in a durable route table, and replies via zero-credential SMS. Uses the `[telnyx]` binding for zero-credential messaging and inference — no API key anywhere in code.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. This example composes durable state, zero-credential messaging, and LLM inference on Edge Compute in a single deployable function — an intelligent SMS router that understands customer intent.

## Telnyx API Endpoints Used

- **Messaging**: `POST /v2/messages` — via `this.env.TELNYX.messages.send()` (pre-authenticated binding, zero-credential)
- **AI Inference**: `POST /v2/ai/openai/chat/completions` — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated binding, zero-credential) for topic classification
- **KV Storage** — `this.env.ROUTES.get()` / `this.env.ROUTES.put()` for the route table (global key-value store, separate from per-actor state)

## Architecture

```
  Inbound SMS → webhook → TriageAgent.triage(from, text)
        │
        ▼
  ┌──────────────────────────────────────────────────┐
  │ Agent SDK (Stateful Actor)                        │
  │                                                  │
  │  1. LLM classify:                                │
  │     → env.TELNYX.ai.openai.chat                  │
  │       .createCompletion()  (topic detection)     │
  │     → topic = billing | support | sales | general│
  │  2. KV route table lookup:                        │
  │     → env.ROUTES.get("route/billing")            │
  │     → returns queue name (global, not per-actor)  │
  │  3. Reply via SMS:                                │
  │     → env.TELNYX.messages.send()  (zero-cred)   │
  │  4. Log triage entry:                             │
  │     → state.triageHistory[] (durable, per-actor) │
  │     → state.topicCounts[topic]++                 │
  └──────────────────────────────────────────────────┘
```

## Environment Variables / Secrets

No API key needed in code — the `[telnyx]` binding in `telnyx.toml` carries auth for both messaging and inference.

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `[telnyx]` binding | toml | **yes** | Pre-authenticated Telnyx client (messaging + inference) |
| `[[kv]] ROUTES` binding | toml | **yes** | KV namespace for the route table (keys: `route/<topic>`) |
| `AI_MODEL` | env_var | no | Inference model name (default: `moonshotai/Kimi-K2.6`) |

> **Agent / CLI access**
>
> ```bash
> # Buy a phone number for the triage bot
> telnyx number-orders create --phone-number "+16282564655"
>
> # List your numbers
> telnyx numbers list
> ```

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx phone number with a messaging profile (for real SMS)

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-sms-triage-bot
npm install
```

### 2. Deploy

```bash
telnyx-edge ship
```

`ship` prints a URL like `agent-sms-triage-bot-<id>.telnyxcompute.com`.

<details><summary>Programmatic / CLI setup</summary>

```bash
# Buy a number (if you don't have one)
telnyx number-orders create --phone-number "+16282564655"

# Create a messaging profile
telnyx messaging-profiles create --name "triage-bot"

# Assign the number to the messaging profile
telnyx numbers update +16282564655 --messaging-profile-id <profile_id>
```

</details>

### 3. Point your messaging profile webhook

In the [Telnyx Portal](https://portal.telnyx.com/messaging/profiles):
1. Create or edit a Messaging Profile assigned to your Telnyx number
2. Set the **Webhook URL** → `https://agent-sms-triage-bot-<id>.telnyxcompute.com/webhooks/sms`

### 4. Test

```bash
# Health check
curl https://agent-sms-triage-bot-<id>.telnyxcompute.com/health/liveness

# Simulate an inbound billing question (no real SMS needed)
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/debug/triage \
  -H "Content-Type: application/json" \
  -d '{"from":"+17177247292","text":"Why was I charged $50 on my last invoice?"}'

# View triage history
curl "https://agent-sms-triage-bot-<id>.telnyxcompute.com/history?number=+16282564655"

# Update a route
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"topic":"billing","queue":"priority-billing-queue"}'
```

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/API.md) for the full typed endpoint reference.

## How It Works

1. **Inbound SMS** → Telnyx sends `message.received` webhook → the handler routes to the `TriageAgent` actor keyed by the inbound number
2. **Classify** — `triage()` calls `this.env.TELNYX.ai.openai.chat.createCompletion()` with a system prompt that classifies the message into billing/support/sales/general
3. **Route lookup** — the topic is looked up in the KV route table (`this.env.ROUTES.get("route/billing")` → queue name). KV is a global key-value store, separate from per-actor state — all actors share the same route table.
4. **Reply** — a confirmation SMS is sent to the customer via `this.env.TELNYX.messages.send()` (zero-credential), including the routed queue reference
5. **Log** — the triage entry (timestamp, from, text, topic, route, confidence) is stored in durable actor state for analytics
6. **Persistence** — the KV route table is global and durable; triage history and topic counts are per-actor and survive restarts

## Agent SDK Primitives Used

| Primitive | API | What it does |
|-----------|-----|--------------|
| Durable State | `this.setState()` / `this.getState()` | Triage history, topic counts (per-actor) |
| KV Namespace | `this.env.ROUTES.get()` / `this.env.ROUTES.put()` | Global route table (shared across all actors) |
| Telnyx Binding | `this.env.TELNYX.messages.send()` | Zero-credential SMS replies |
| Telnyx Binding | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential topic classification |

## Route Table (KV)

The route table is stored in a KV namespace (`ROUTES`), keyed as `route/<topic>`. It's global — all actor instances share the same routes. It can be updated at runtime via `POST /routes`, which calls `this.env.ROUTES.put("route/billing", "priority-billing-queue")`.

| Key | Default Value |
|-------|---------------|
| `route/billing` | billing-queue |
| `route/support` | support-queue |
| `route/sales` | sales-queue |
| `route/general` | general-queue |

### Provisioning the KV namespace

```bash
# Create the KV namespace
telnyx-edge storage kv create --name "triage-routes"

# Seed default routes (keys use / separator — colons are not allowed in KV keys)
telnyx-edge storage kv key put <namespace-id> route/billing billing-queue
telnyx-edge storage kv key put <namespace-id> route/support support-queue
telnyx-edge storage kv key put <namespace-id> route/sales sales-queue
telnyx-edge storage kv key put <namespace-id> route/general general-queue

# Add the binding to telnyx.toml:
# [[kv]]
# binding = "ROUTES"
# namespace_id = "<namespace-id>"
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 page not found` | Function still deploying | Wait ~30s, then retry |
| No SMS reply | Messaging profile webhook not set | Point webhook to `/webhooks/sms` |
| Classification always "general" | LLM unavailable or misclassified | Check `AI_MODEL` env var — use a reasoning model with sufficient `max_tokens` |
| Actor not processing | `[telnyx]` binding missing | Ensure `telnyx.toml` has `[telnyx] binding = "TELNYX"` |

## Related Examples

- [Scheduled Reminder Agent (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/scheduled-reminder-agent/README.md)
- [SMS Support Agent with Follow-Up (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-support-agent-with-followup/README.md)
- [Edge Voice Agent That Holds a Call (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voice-agent-holds-call/README.md)
- [Edge URL Summarizer (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-url-summarizer/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK Quickstart](https://developers.telnyx.com/docs/agent-sdk/quickstart)
- [Roll Your Own Agent](https://developers.telnyx.com/docs/agent-sdk/examples/roll-your-own)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
