# Order Status Self-Service — Developer Guide

A step-by-step tutorial for the `order-status-self-service` sample: a durable per-customer actor that answers "where's my order?" via SMS and proactively texts delay notices before the customer asks.

## Prerequisites

- Node.js 18+
- `telnyx-edge` CLI (`npm i -g telnyx-edge`)
- A Telnyx account with a messaging profile and phone number
- TypeScript familiarity

## Project Layout

```
order-status-self-service/
├── src/index.ts          # OrderAgent class + Edge fetch handler
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
├── smoke_test.ts
└── GUIDE.md
```

## Environment Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure bindings**

   Edit `telnyx.toml` — the actor binding (`CUSTOMERS`), the Telnyx API binding (`TELNYX`), and the SQL database binding (`ORDERS_DB`) are declared there. Regenerate types:

   ```bash
   telnyx-edge types
   ```

   This produces `telnyx-env.d.ts` with typed `Env` bindings.

3. **Set secrets**

   ```bash
   telnyx-edge secrets add TELNYX_API_KEY "your_api_key_here"
   ```

   The `TELNYX` binding is zero-credential — the platform injects auth from the secret. No API key appears in code.

4. **Demo mode (default)**

   `DEMO_MODE=true` is the default. In demo mode the actor **logs** SMS messages instead of sending real ones, and uses a built-in plain-language interpreter instead of calling the LLM. No charges are incurred.

   To switch to **live mode**, set `DEMO_MODE=false` (or unset it) and provide a real `SMS_FROM` number:

   ```bash
   telnyx-edge secrets add DEMO_MODE "false"
   telnyx-edge secrets add SMS_FROM "+1555XXXXXXXX"
   ```

   In live mode, `this.env.TELNYX.ai.openai.chat.createCompletion` is called to generate the one-line plain-language answer, and `this.env.TELNYX.messages.send` dispatches real SMS.

## How It Works

### 1. The Actor Is the Customer

The `OrderAgent` class (defined in `src/index.ts`) extends `Agent<Env, CustomerState>`. Each customer gets exactly one durable actor, provisioned on demand via `env.CUSTOMERS.idFromName(customerE164)`. The actor's durable state holds:

- `customer` — the E.164 phone number
- `linked` — array of order IDs linked to this customer
- `lastNotified` — the last order ID that received a proactive delay text (exactly-once guard)

The actor also owns an **agent SQL table** `orders(orderId, status, eta, ts)` — the durable order record that survives eviction between interactions.

### 2. Linking an Order (`linkOrder` RPC)

When a storefront completes a purchase, it calls the `/rpc/linkOrder` endpoint. The Edge `fetch` handler extracts `customerE164` from the query string, resolves the actor stub via `env.CUSTOMERS.idFromName(customerE164)`, and invokes `stub.linkOrder(customerE164, orderId, carrier)`.

Inside `linkOrder`:
- The actor's `customer` field is set.
- The `orderId` is appended to `linked` (idempotent).
- The `orders` SQL schema is ensured (`ensureSchema`).
- A `pending` row is inserted for the order.

### 3. Carrier Webhook Seam (`onCarrier`)

Carrier status webhooks (shipped / delayed / delivered) arrive at `/webhook/carrier`. The fetch handler routes them to `stub.onCarrier(event)`.

`onCarrier` does three things:
1. **Idempotency check** — queries the existing `orders` row for this `orderId`. If the `status` and `ts` match a previously recorded event, it returns early (no double-text on webhook redelivery).
2. **State update** — `INSERT OR REPLACE` into the `orders` SQL table with the new status, ETA, and timestamp.
3. **Proactive action**:
   - For `shipped` / `delivered`: sends a status SMS immediately via `sendSms`.
   - For `delayed`: calls `this.schedule(0, "notifyDelay", { event }, { id: "delay:" + event.orderId })` — a zero-delay scheduled task that wakes the actor to send the delay notice.

### 4. Inbound Self-Service (`onInboundMessage`)

When the customer texts "where's my order?", Telnyx delivers an `inbound-message` callback to `/webhook/inbound`. The fetch handler routes it to `stub.onInboundMessage(msg)`.

`onInboundMessage`:
1. Queries the `orders` SQL table for all orders linked to this customer (`ORDER BY ts DESC`).
2. Calls `answerSms(msg, rows)` which:
   - Returns a "no orders linked" message if the table is empty.
   - Otherwise calls `interpretStatus(latest)` to produce a one-line plain-language answer.
3. Sends the answer back via `sendSms(msg.from, answer)`.

### 5. Plain-Language Interpretation (`interpretStatus`)

In **live mode**, `interpretStatus` calls `this.env.TELNYX.ai.openai.chat.createCompletion` with a prompt that turns the raw `status` + `eta` into a single customer-friendly sentence (e.g., "On the way — out for delivery tomorrow, slightly earlier than the original ETA.").

In **demo mode**, a built-in `demoInterpretation` switch statement returns canned responses — no LLM call, no charges.

### 6. Proactive Delay Notification (`notifyDelay`)

The scheduled task `notifyDelay` is the actor's self-wake mechanism for delay events:

1. **Exactly-once guard** — if `this.state.lastNotified === payload.event.orderId`, it returns immediately (the delay was already notified).
2. Sends the delay SMS via `sendSms(this.state.customer, this.delaySms(payload.event))`.
3. Updates `lastNotified` to the order ID via `setState`.

This guarantees the customer receives the delay notice **exactly once**, even if the webhook is redelivered or the actor is evicted and re-woken.

### 7. Follow-Up In-Thread

Because the actor is durable and owns message history, a follow-up text like "will it make it by Friday?" arrives at the same `/webhook/inbound` endpoint. The fetch handler resolves the same actor stub (same `customerE164`), and `onInboundMessage` reads the current `orders` SQL state — no re-identification needed. The actor answers from its durable state.

### 8. Restart Proof

If the Edge function is killed between a carrier webhook and the proactive text:
- The `orders` SQL state is already persisted (written before the `schedule` call).
- On the customer's next inbound message, the actor is re-woken with full state.
- The `lastNotified` guard prevents a duplicate delay notification.

## Telnyx Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK** (`Agent<Env, CustomerState>`) | The durable per-customer entity. Owns state + SQL + scheduling. |
| **Agent SQL** (`this.sql` / `this.env.ORDERS_DB`) | `orders(orderId, status, eta, ts)` table — durable order state. |
| **`this.schedule()`** | Zero-delay task to wake the actor for proactive delay notification. |
| **Two-way SMS** (`inbound-message` + `send-a-message`) | Inbound: customer asks "where's my order?". Outbound: status answer + proactive delay notice. |
| **Inference** (`this.env.TELNYX.ai.openai.chat.createCompletion`) | Converts raw order state into a one-line plain-language answer. |
| **Webhook seam** (Edge `fetch` → `stub.onCarrier`) | Carrier status webhooks trigger proactive state updates + texts. |
| **Actor namespace** (`env.CUSTOMERS.idFromName`) | One durable actor per customer, self-provisioned on first contact. |

## Demo Flow Walkthrough

1. **Customer places an order** → storefront calls `/rpc/linkOrder?customer=+15551234567` with `{ orderId, carrier }` → `OrderAgent` is born via `idFromName`, `orders` table gets a `pending` row.
2. **Carrier webhook (shipped)** → `/webhook/carrier` → `onCarrier` updates SQL to `shipped` + sends proactive SMS: "Your order is on the way — out for delivery Tue."
3. **Customer texts "where's my order?"** → `/webhook/inbound` → `onInboundMessage` reads SQL + sends: "On the way — out for delivery tomorrow. (Order ORD-123)"
4. **Follow-up: "will it make it by Friday?"** → same actor, same thread → answers from ETA in SQL state.
5. **Day 3 — carrier webhook (delay)** → `onCarrier` schedules `notifyDelay` → actor wakes → texts: "Heads up — your order is delayed to Fri; here's why and your new ETA."
6. **Restart proof** — kill the worker between webhook and text → SQL state intact → next inbound re-wakes actor → delay notification sent exactly once.

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies the `OrderAgent` class shape, method existence (`linkOrder`, `onCarrier`, `onInboundMessage`, `notifyDelay`), and that the module loads without error.

## Deploying

```bash
telnyx-edge ship
```

This deploys the Edge worker with the actor bindings declared in `telnyx.toml`.

## Next Steps

- [Telnyx Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SQL reference](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Calling LLMs from agents](https://developers.telnyx.com/docs/agent-sdk/concepts/calling-llms)
- [Stateful actors on Telnyx Edge](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Send SMS via Telnyx API](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Inbound message webhook reference](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Agent memory (Cloudflare pattern)](https://blog.cloudflare.com/introducing-agent-memory)
- [Voice self-service pattern](https://developers.cloudflare.com/agents/examples/voice-agent/)
