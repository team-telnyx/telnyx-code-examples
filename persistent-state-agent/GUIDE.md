# Guide: CustomerAgent (LangGraph) on Edge

A standalone tutorial for running a LangGraph `StateGraph` inside a per-customer `CustomerAgent` actor on Telnyx Edge Compute with zero-credential LLM inference.

## What you'll build

A per-customer durable agent that:

1. Receives an SMS webhook from a customer
2. Routes the inbound into the per-customer `CustomerAgent` actor (keyed by E.164 phone)
3. Classifies the message intent (order vs. smalltalk) using a LangGraph node
4. Looks up order status if the intent is "order"
5. Composes a reply using another LangGraph node
6. Sends the reply via the pre-authenticated Telnyx API binding (no API key)
7. Persists `CustomerState` (identity, history, coordination state) for the same phone across requests
8. Exposes the durable state at `GET /context` for verification
9. Schedules a 24-hour follow-up nudge

## Key concepts

### The customer is the durable entity

`Conversation` is not the unit of durability. **The customer is.** A `CustomerAgent` actor is keyed by the customer's normalized E.164 phone (`customer-<digits>`), and `CustomerState` is the customer's truth:

```
CustomerAgent (actor instance, keyed by phone_e164)
  └─ CustomerState
       ├─ phone_e164      ← identity
       ├─ name            ← Anusha (seeded for demo)
       ├─ salesforce_id   ← mock-anusha-salesforce-id (Gate 1)
       ├─ open_tickets    ← Salesforce Case refs (Gate 3+)
       ├─ shipments       ← Shipment refs (Gate 5+)
       ├─ escalation_pending ← HITL escalation (Gate 6)
       ├─ active_schedule_ids ← Self-waking schedules (Gate 5+)
       ├─ history         ← durable message log
       └─ turn state      ← SMS coordination
```

SMS, voice, Salesforce webhooks, and self-scheduled wakes all route to the same actor. Future gates add fields; the actor identity never changes.

### The zero-credential adapter

The Telnyx API binding (`this.env.TELNYX`) is pre-authenticated at the edge — no API key in your code. But LangGraph nodes call the LLM through a `BaseChatModel`. The stock `ChatOpenAI` requires an `apiKey` and `baseURL`.

This sample ships `TelnyxBoundChatModel` — a minimal `SimpleChatModel` subclass that calls `this.env.TELNYX.ai.openai.chat.createCompletion()` under the hood:

```typescript
class TelnyxBoundChatModel extends SimpleChatModel {
  async _call(messages: BaseMessage[]): Promise<string> {
    const mapped = messages.map(m => ({ role: roleForMessage(m), content: ... }));
    const res = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: this.model,
      messages: mapped,
    });
    return res.choices[0].message.content;
  }
}
```

This is the key innovation: LangGraph gets its chat-model interface, and you get zero-credential inference. No `TELNYX_API_KEY` in code, bundle, or logs.

### The turn state machine

At-least-once delivery means a crash can retry `process()`. The turn state machine prevents duplicates:

```
receive() → turn=1, queuedTurn=1, queue("process")
process() → targetTurn=1, lastSentTurn=0 → run graph → stage pendingOutbound → send → lastSentTurn=1
```

If two inbound messages arrive before `process()` runs:
```
receive() → turn=1, queuedTurn=1, queue("process")
receive() → turn=2, queuedTurn=2, queue("process")
process() → targetTurn=2 (latest) → run graph → send → lastSentTurn=2
process() → targetTurn=2 ≤ lastSentTurn=2 → NO-OP (stale)
```

### Three state layers

Don't conflate these:

1. **LangGraph graph state** — `intentLabel`, `actionResult`, `replyText` — ephemeral, one `process()` run
2. **Agent SDK durable state** — `CustomerState` (`phone_e164`, `name`, `history`, turn fields) — survives restarts, per actor
3. **Agent SDK message history** — `this.messages` — the conversation log, per actor (also mirrored into `CustomerState.history` for visibility)

## Step-by-step

### 1. The actor (`src/customer-agent.ts`)

`CustomerAgent extends Agent<Env, CustomerState>`:

- `initialState()` seeds the demo customer (Anusha) with the mock Salesforce ID and empty external refs.
- `receive({ text, from, to, eventId })` — dedupes by `eventId`, sets `state.phone_e164`, appends to `state.history`, bumps turn, queues `process()`. No LLM calls (30s budget).
- `process()` — stale-task guard, runs graph, stages `pendingOutbound`, sends SMS, commits `lastSentTurn`, appends assistant reply to `state.history`.
- `getContext()` — returns the full `CustomerContext` for `GET /context`.

### 2. The adapter (`src/telnyx-bound-chat-model.ts`)

The `TelnyxBoundChatModel` extends `SimpleChatModel` from `@langchain/core`. It maps LangChain `BaseMessage[]` to `{role, content}[]` and calls the binding.

Key: the adapter takes `{ env, model }` in its constructor. The actor owns `this.env`, so the adapter is constructed inside `process()`.

### 3. The graph (`src/graph.ts`)

A 3-node `StateGraph` with typed channels:

```typescript
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (_, y) => y }),
  intentLabel: Annotation<Intent>(),
  actionResult: Annotation<string>(),
  replyText: Annotation<string>(),
});

const graph = new StateGraph(GraphState)
  .addNode("intent", intentNode)     // LLM classify
  .addNode("action", actionNode)     // plain TS lookup
  .addNode("response", responseNode) // LLM compose
  .addEdge(START, "intent")
  .addConditionalEdges("intent", s => s.intentLabel === "order" ? "action" : "response")
  .addEdge("action", "response")
  .addEdge("response", END)
  .compile();
```

> **Important:** LangGraph node names cannot match state channel names. Use `intentLabel` (not `intent`) as the channel, `intent` as the node.

### 4. The webhook handler (`src/index.ts`)

Verifies the Ed25519 signature using the `telnyx` SDK's `webhooks.unwrap()`, normalizes the inbound phone to E.164, then routes to the actor:

```typescript
const normalizedFrom = normalizePhoneE164(from, "");
const { customer } = customerForPhone(env, normalizedFrom);
await customer.receive({ text, from: normalizedFrom, to, eventId });
```

`customerForPhone` derives `customer-<digits>` from the phone and returns the actor handle. The same phone always resolves to the same actor.

### 5. The debug route (`GET /context`)

```bash
curl "https://persistent-state-agent-<your-org>.telnyxcompute.com/context?phone=%2B15551234567"
```

Returns the full `CustomerContext` — proves the actor persisted across requests.

### 6. Deploy

```bash
telnyx-edge types   # generate Env types from telnyx.toml
telnyx-edge ship     # deploy to edge
```

Point your messaging profile webhook at the function URL. Send an SMS. Get a reply. Send a second SMS — it hits the same actor and `state.history` shows both turns.

## Next steps (later gates)

- Gate 2 — replace `order` / `smalltalk` / `unknown` intents with `case_update`, `shipment_status`, `human_escalation`, `smalltalk`, `unknown`. The graph returns a structured action plan; the actor validates side effects.
- Gate 3 — mock Salesforce client. `state.salesforce_id` resolves to a mock Case and shipment.
- Gate 4 — real Salesforce via OAuth client credentials.
- Gate 5 — `POST /webhooks/salesforce` + self-waking `this.schedule(...)`.
- Gate 6 — `escalateToHuman` / `resumeEscalation` and `POST /hitl/reply`.
- Gate 7 — `POST /webhooks/voice` resolving the same `CustomerAgent` by caller phone.
- Gate 8 — README, demo script, blog, Medium, YouTube outline.
