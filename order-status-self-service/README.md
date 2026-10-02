---
name: order-status-self-service
title: "Order Status Self-Service — Durable Actor Answers 'Where Is My Order?'"
description: "A customer texts the store's line asking 'where's my order?' and a durable OrderAgent answers from its own per-actor SQL state and message history; carrier webhooks proactively text delays before the customer asks."
language: typescript
framework: edge
telnyx_products: [Messaging, Agent SDK, AI]
---

# Order Status Self-Service — Durable Actor Answers "Where Is My Order?"

A customer texts the store's line asking "where's my order?" and a durable `OrderAgent` answers from its own per-actor SQL state and message history; carrier webhooks proactively text delays before the customer asks.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a platform where durable, stateful actors are first-class primitives, messaging is two-way and carrier-grade, and AI inference is bound directly into the edge runtime without managing API keys. Unlike stateless functions that forget everything between invocations, Telnyx's Agent SDK gives each actor per-entity SQL persistence, a durable conversation memory (MessageLog), and scheduled task execution so an actor like `OrderAgent` can own a customer's order history and thread across days. The zero-credential `TELNYX` binding injects auth at the platform level, and the `ai.openai.chat.createCompletion` seam turns raw order state into a one-line plain-language answer — all without secrets in code.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `env.TELNYX.messages.send({ to, from, text })` | Messaging | Sends proactive status texts and answers to inbound questions |
| `message.received` webhook callback (`inbound-message`) | Messaging | Receives the customer's "where's my order?" text |
| `env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` | AI | Converts raw order state + thread into a one-line plain-language answer (Telnyx-hosted model, no keys) |
| `env.CUSTOMERS.idFromName(customerE164)` | Agent SDK | Self-provisions one durable actor per customer phone number |
| `this.ctx.storage.sql.exec(...)` | Agent SDK SQL | Durable per-actor `orders(order_id, customer, status, eta, ts)` table |
| `this.messages` (MessageLog) | Agent SDK | Durable SMS thread — follow-ups resolve without re-identification |
| `this.schedule(0, "notifyDelay", ...)` | Agent SDK | Wakes the actor to send the proactive delay notification (exactly-once) |

## Architecture

```
                ┌──────────────────────────────────────────────────────┐
                │                 Telnyx Edge Runtime                   │
                │                                                      │
  Storefront    │   ┌────────────────────────────────────┐             │
  linkOrder() ──┼──►│            OrderAgent              │             │
                │   │            (extends Agent)         │             │
                │   │   one durable actor per customer   │             │
                │   │   env.CUSTOMERS.idFromName(e164)   │             │
  Carrier       │   │                                    │             │
  webhook ──────┼──►│   onCarrier()                      │             │
  shipped/      │   │     → SQL orders upsert            │             │
  delayed/      │   │     → shipped/delivered: SMS now   │             │
  delivered     │   │     → delayed: schedule(notifyDelay)             │
                │   │                                    │             │
  Customer SMS  │   │   onInboundMessage("where's my…")  │             │
  "where's my   │   │     → SQL rows + MessageLog thread │             │
  order?"  ─────┼──►│     → LLM one-line interpretation  │             │
                │   │     → SMS reply                    │             │
                │   │                                    │             │
                │   │   notifyDelay()  ← schedule wake   │             │
                │   │     → proactive SMS (exactly-once) │             │
                │   └────────────────────────────────────┘             │
                │                                                      │
                │   Durable state: per-actor SQL (orders)              │
                │   + CustomerState + MessageLog thread                │
                │   (survives eviction, reboot, webhook redelivery)    │
                └──────────────────────────────────────────────────────┘
```

**Flow:**

1. **Storefront** calls `POST /rpc/linkOrder?customer=<E.164>` → `env.CUSTOMERS.idFromName(customerE164)` → actor born, `orders` table created, order inserted as `pending`.
2. **Carrier webhook** hits `POST /webhook/carrier` → `onCarrier(event)` → SQL upsert; for `shipped`/`delivered` → immediate SMS ("Your order is on the way — out for delivery Tue."); for `delayed` → `this.schedule(0, "notifyDelay", ...)` wakes the actor.
3. **Customer texts** "where's my order?" → Telnyx `message.received` callback → `/webhook/inbound` → `onInboundMessage(msg)` → reads `orders` SQL → `buildAnswer()` produces the one-line plain-language read ("On the way — out for delivery Tue.") → SMS reply.
4. **Follow-up** "will it make it by Friday?" → same actor, same thread → answered from durable state + MessageLog history — no re-identification.
5. **Delay webhook** (day 3) → `notifyDelay()` → `lastNotified` guard ensures exactly-once → proactive SMS before the customer asks.
6. **Restart proof** → worker killed between webhook and text → SQL state intact → next inbound re-wakes actor with full state → no double notification.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key — injected automatically by the `[telnyx]` binding; also used by the `telnyx-edge` CLI | [Telnyx Portal → API Keys](https://portal.telnyx.com) |
| `DEMO_MODE` | `string` | `true` / `false` | no | `true` (default) logs SMS and uses the deterministic demo interpreter instead of calling the LLM; `false` sends real SMS and calls Telnyx-hosted inference | set in `telnyx.toml` `[env_vars]` |
| `SMS_FROM` | `string` | `+16282564655` | no (live mode) | SMS-capable sender number in E.164, passed into the actor explicitly | buy a number at [telnyx.com](https://telnyx.com/products/number-api) |
| `AI_MODEL` | `string` | `zai-org/GLM-5.3-Flash` | no | Telnyx-hosted inference model (default `zai-org/GLM-5.3-Flash` — no BYOK key needed) | [Telnyx Inference models](https://developers.telnyx.com/docs/ai/inference) |

> **Agent / CLI access** — all of the above can be provisioned from the CLI/agent without the portal:
>
> ```bash
> telnyx auth set-key KEY…               # human CLI auth (or TELNYX_API_KEY env var for agents)
> telnyx number-orders create --profile international --quantity 1   # buy an SMS-capable number
> telnyx-edge new-func --actor -l ts -n order-status-self-service    # register the actor function
> ```

## Setup

### Prerequisites

- Node.js 18+ and npm
- Docker (compose plugin) — for `telnyx-edge dev`
- A Telnyx account with an SMS-capable number (10DLC campaign required for US A2P traffic)
- Telnyx Edge CLI: install from [github.com/team-telnyx/edge-compute/releases](https://github.com/team-telnyx/edge-compute/releases)

### Local Development

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/order-status-self-service

# Authenticate the Edge CLI (or export TELNYX_API_KEY)
export TELNYX_API_KEY=your_telnyx_api_key_here

# Install dependencies
npm install

# Typecheck + smoke test (loads the module, verifies the Agent contract)
npm run typecheck
npm test
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Create the StatefulActor function (registers func_id with the platform)
telnyx-edge new-func --actor -l ts -n order-status-self-service
# → copy the printed func_id into telnyx.toml [edge_compute]

# Ship to Telnyx Edge (~5-10 min: upload, build, deploy)
telnyx-edge ship

# Point the messaging profile's inbound webhook at the deployed function:
#   inbound-message callback → https://<your-function>.telnyxcompute.com/webhook/inbound

# Deployed URL is printed at the end; also visible via:
telnyx-edge list
```
</details>

### Deploy and Run

```bash
# Ship to Telnyx Edge Compute
telnyx-edge ship

# Health check
curl https://<your-function>.telnyxcompute.com/health

# 1. Storefront links an order (actor born via idFromName)
curl -X POST 'https://<your-function>.telnyxcompute.com/rpc/linkOrder?customer=%2B15551234567' \
  -H "Content-Type: application/json" \
  -d '{"orderId": "ORD-1001", "carrier": "medship"}'

# 2. Carrier reports shipped → proactive SMS ("Your order ORD-1001 is on the way — out for delivery Tue.")
curl -X POST 'https://<your-function>.telnyxcompute.com/webhook/carrier?customer=%2B15551234567' \
  -H "Content-Type: application/json" \
  -d '{"kind": "shipped", "orderId": "ORD-1001", "eta": "Tue", "ts": 1767225600000}'

# 3. Customer asks (simulated — in production this is the Telnyx message.received callback)
curl -X POST https://<your-function>.telnyxcompute.com/webhook/inbound \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "message.received", "payload": {"from": {"phone_number": "+15551234567"}, "text": "where'"'"'s my order?"}}}'

# 4. Customer asks about the ETA (same thread, durable history)
curl -X POST https://<your-function>.telnyxcompute.com/webhook/inbound \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "message.received", "payload": {"from": {"phone_number": "+15551234567"}, "text": "will it make it by Friday?"}}}'

# 5. Carrier reports a delay → actor wakes itself and texts BEFORE the customer asks
curl -X POST 'https://<your-function>.telnyxcompute.com/webhook/carrier?customer=%2B15551234567' \
  -H "Content-Type: application/json" \
  -d '{"kind": "delayed", "orderId": "ORD-1001", "eta": "Fri", "ts": 1767484800000, "reason": "weather hold"}'
```

Demo mode (default) logs every SMS to the actor console instead of sending — no charges. Live mode: set `DEMO_MODE = "false"` in `telnyx.toml` `[env_vars]`, set `SMS_FROM`, and re-ship.

**Important:** `[env_vars]` in `telnyx.toml` are injected into the **function runtime's** `process.env` only — the actor runtime has its own empty `process.env`. The fetch handler therefore passes `DEMO_MODE`, `SMS_FROM`, and `AI_MODEL` into the actor methods explicitly. Do not read those env vars directly inside the agent class.

### Project Structure

```
order-status-self-service/
├── src/
│   └── index.ts          # Main entry — fetch front door + OrderAgent
├── telnyx.toml           # Edge manifest — actors, [telnyx] binding, env vars
├── package.json
├── tsconfig.json
├── smoke_test.ts
├── .env.example
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md
```

## API Reference

Full typed endpoint reference in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/order-status-self-service/API.md).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rpc/linkOrder?customer=<E.164>` | Storefront links a customer's order to the actor |
| `POST` | `/webhook/carrier?customer=<E.164>` | Carrier webhook (`shipped`/`delayed`/`delivered`) |
| `POST` | `/webhook/inbound` | Telnyx `message.received` callback |
| `GET` | `/health` | Health check |

### Actor Methods

| Method | Trigger | Description |
|--------|---------|-------------|
| `linkOrder(customerE164, orderId, carrier)` | RPC | Creates the actor, links the order, initializes SQL |
| `onCarrier(event, opts)` | Webhook | Updates `orders` SQL, sends proactive text or schedules the delay notification |
| `onInboundMessage(msg, opts)` | Webhook | Answers "where's my order?" from durable state + thread |
| `notifyDelay(payload)` | Scheduled task | Sends exactly-once proactive delay notification |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Actor not found on webhook | Customer E.164 missing from query/body | Ensure `?customer=<E.164>` is on the carrier/linkOrder URLs |
| No SMS sent in demo mode | `DEMO_MODE` is `"true"` (default) — SMS is logged to the actor console | Set `DEMO_MODE = "false"` in `telnyx.toml` `[env_vars]` and re-ship |
| `SMS_FROM is required in live mode` | Live mode without a sender number | Set `SMS_FROM` in `[env_vars]` (or `.env` locally) with an SMS-capable number |
| `message.received` rejected with 400 | Payload isn't the Telnyx inbound-message shape | The handler expects `data.event_type === "message.received"` and `data.payload.from.phone_number` |
| Double delay notification | `lastNotified` guard bypassed | The schedule id `delay:<orderId>` dedupes replays; ensure the delay event `ts` differs only for genuinely new delays |
| OpenAI call fails in live mode | Model unavailable | The agent falls back to the deterministic `demoAnswer()`; check `AI_MODEL` is a Telnyx-hosted model |
| Webhook redelivered | Carrier retries | `onCarrier` idempotency guard compares `status` + `ts` before re-sending |

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

- [shipment-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/shipment-agent/README.md) — The actor IS the *package* (DEV-840): push-only status notifications across carriers
- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — Durable entity agent per phone number (StatefulActors deep-dive)
- [agent-sms-triage-bot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md) — Inbound SMS triage with a scheduled agent
- [sms-two-factor-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-agent/README.md) — SMS two-factor auth on the same Agent SDK primitives

## Resources

- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Send Message Guide](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Inbound Message Callback Reference](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Messaging Product](https://telnyx.com/products/sms-api)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
