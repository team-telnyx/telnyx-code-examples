---
name: order-status-self-service
title: "Order Status Self-Service — Durable Actor Answers 'Where Is My Order?'"
description: "A customer texts or calls the store's line asking 'where's my order?' and a durable OrderAgent answers from its own SQL state, plus proactively texts delays before the customer asks."
language: typescript
framework: edge
telnyx_products: [Messaging, Agent SDK, AI, Voice]
---

# Order Status Self-Service — Durable Actor Answers "Where Is My Order?"

A customer texts or calls the store's line asking "where's my order?" and a durable `OrderAgent` answers from its own SQL state, plus proactively texts delays before the customer asks.

## The Story

A regional medical-supply logistics firm, MedShip Logistics, delivers time-sensitive equipment — oxygen concentrators, wound-care kits, mobility aids — to hundreds of clinics across the Midwest. Each delivery window is tied to a patient appointment; a missed or delayed delivery can postpone a procedure, force a clinic to reschedule, and in some cases put patient care at risk. The firm's support desk spends 40% of its day answering the same question: "Where is my order?" — fielding calls, digging through carrier portals, and manually texting back status updates that are often stale by the time they're sent. If the system fails, the cost is measured in delayed care, eroded clinic trust, and a support team that can never scale.

The actor IS the customer. When a clinic places an order, the `OrderAgent` is born — one durable actor per customer phone number — and it becomes the clinic's persistent order record and conversation memory. It survives platform reboots, worker evictions, and carrier webhook redeliveries: when a carrier reports a delay on day three, the actor wakes itself and texts the clinic *before* the clinic calls. When the clinic finally texts "where's my order?", the actor reads its own SQL state and answers in plain language, remembering the thread so a follow-up like "will it make it by Friday?" resolves without re-identification. Durability is the point — the actor's state outlives every infrastructure interruption, so the customer's question is always answered from truth, not guesswork.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a platform where durable, stateful actors are first-class primitives, messaging is two-way and carrier-grade, and AI inference is bound directly into the edge runtime without managing API keys. Unlike stateless functions that forget everything between invocations, Telnyx's Agent SDK gives you per-entity durable storage, scheduled task execution, and SQL persistence so an actor like `OrderAgent` can own a customer's order history and conversation memory across days. The zero-credential `TELNYX` binding injects auth at the platform level, and the `ai.openai.chat.createCompletion` seam lets the actor turn raw order state into a one-line plain-language answer — all without secrets in code. This is the infrastructure that makes a self-service order-status actor possible at the edge.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `env.TELNYX.messages.send({ to, from, text })` | Messaging | Sends proactive status texts and answers to inbound questions |
| `inbound-message` webhook callback | Messaging | Receives the customer's "where's my order?" text |
| `env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` | AI | Converts raw order state into a one-line plain-language answer |
| `env.CUSTOMERS.idFromName(customerE164)` | Agent SDK | Self-provisions one durable actor per customer phone number |
| `this.sql(...)` via `ORDERS_DB` binding | Agent SDK SQL | Durable `orders(orderId, status, eta, ts)` table per customer |
| `this.schedule(0, "notifyDelay", ...)` | Agent SDK | Wakes the actor to send a proactive delay notification (exactly-once) |

## Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Telnyx Edge Runtime                     │
                    │                                                     │
  Storefront RPC    │   ┌──────────────┐                                   │
  linkOrder()       │   │  OrderAgent  │  ← one durable actor per customer │
  (customerE164,    │   │  (Agent)     │    env.CUSTOMERS.idFromName()      │
   orderId, carrier)│   │              │                                   │
       ────────────►│   │  linkOrder() │  INSERT INTO orders(...)          │
                    │   │              │  setState({ customer, linked })   │
                    │   │  onCarrier() │  INSERT OR REPLACE orders(...)    │
  Carrier Webhook   │   │              │  schedule("notifyDelay")          │
  (shipped/delayed/ │   │              │  sendSms() → TELNYX.messages.send │
   delivered)        │   │              │  this.sql() → ORDERS_DB            │
       ────────────►│   │              │  this.env.TELNYX.ai.openai        │
                    │   │              │    .chat.createCompletion()        │
  Customer SMS      │   │  onInbound   │                                   │
  "where's my order?"│   │  Message()   │  SELECT * FROM orders WHERE ...   │
       ────────────►│   │              │  answerSms() → interpretStatus()  │
                    │   │              │  sendSms() → TELNYX.messages.send │
                    │   └──────────────┘                                   │
                    │                                                     │
                    │  Durable State: SQL (orders) + Agent State           │
                    │  (survives eviction, reboot, webhook redelivery)     │
                    └─────────────────────────────────────────────────────┘
```

**Data flow:**

1. **Storefront** calls `/rpc/linkOrder` → `env.CUSTOMERS.idFromName(customerE164)` → actor born, `orders` table created, order inserted as `pending`.
2. **Carrier webhook** hits `/webhook/carrier` → `onCarrier(event)` → SQL updated; for `shipped`/`delivered` → immediate SMS; for `delayed` → `schedule(0, "notifyDelay")` wakes the actor.
3. **Customer texts** "where's my order?" → `/webhook/inbound` → `onInboundMessage(msg)` → reads `orders` SQL → `interpretStatus()` calls OpenAI → `answerSms()` → SMS reply with plain-language status.
4. **Follow-up** "will it make it by Friday?" → same actor, same thread → answers from durable state + message history.
5. **Delay webhook** → `notifyDelay()` → `lastNotified` guard ensures exactly-once → proactive SMS before customer asks.
6. **Restart proof** → worker killed between webhook and text → SQL state intact → next inbound re-wakes actor → no double notification.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/order-status-self-service

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# 4. Generate type bindings from telnyx.toml
npx telnyx-edge types

# 5. Run the smoke test
npx tsx smoke_test.ts

# 6. Deploy (when ready)
npx telnyx-edge auth api-key set <your_api_key>
npx telnyx-edge ship
```

## API Reference

See [API.md](./API.md) for the full typed endpoint reference.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rpc/linkOrder?customer=<E.164>` | Storefront links a customer's order to the actor |
| `POST` | `/webhook/carrier?customer=<E.164>` | Carrier webhook (shipped/delayed/delivered) |
| `POST` | `/webhook/inbound?from=<E.164>` | Telnyx inbound-message callback |

### Actor Methods

| Method | Trigger | Description |
|--------|---------|-------------|
| `linkOrder(customerE164, orderId, carrier)` | RPC | Creates the actor, links the order, initializes SQL |
| `onCarrier(event)` | Webhook | Updates `orders` SQL, sends proactive text or schedules delay notification |
| `onInboundMessage(msg)` | Webhook | Answers "where's my order?" from durable state |
| `notifyDelay(payload)` | Scheduled task | Sends exactly-once proactive delay notification |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Actor not found on webhook | Customer E.164 not passed in query params | Ensure `?customer=<E.164>` is on the webhook URL |
| No SMS sent in demo mode | `DEMO_MODE` not set to `"true"` | Set `DEMO_MODE=true` in `.env` |
| `orders` table missing | `ensureSchema()` not called | It's called automatically in `onCarrier`, `onInboundMessage`, and `linkOrder` |
| Double delay notification | `lastNotified` guard bypassed | Check that `notifyDelay` is scheduled with `{ id: "delay:" + event.orderId }` |
| OpenAI call fails | No API key or model unavailable | In demo mode, falls back to `demoInterpretation()`; in live mode, ensure `TELNYX_API_KEY` has AI access |
| Webhook redelivered | Carrier retries | `onCarrier` idempotency guard checks `status` + `ts` before re-sending |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **[DEV-840 — ShipmentAgent](https://linear.app/telnyx/issue/DEV-840/sprint-2-shipmentagent-the-actor-is-the-package)**: The actor IS the *package* — push-only status notifications. Distinct from this sample where the actor IS the *customer* and answers inbound Q&A.
- **[Voice Agent](https://developers.cloudflare.com/agents/examples/voice-agent/)**: Voice self-service pattern using the same Agent SDK primitives.

## Resources

- [Telnyx Messaging — Send Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Inbound Message Callback](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Agent SDK — SQL](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Agent SDK — Calling LLMs](https://developers.telnyx.com/docs/agent-sdk/concepts/calling-llms)
- [Telnyx Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Cloudflare — Introducing Agent Memory](https://blog.cloudflare.com/introducing-agent-memory)
- [Telnyx Pricing](https://telnyx.com/pricing)
