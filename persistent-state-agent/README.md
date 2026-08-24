# CustomerAgent (LangGraph) on Edge

A `CustomerAgent` is the durable entity. A LangGraph `StateGraph` (intent → action → response) runs inside the per-customer actor on Telnyx Edge Compute, with zero-credential LLM inference via the pre-authenticated Telnyx API binding. SMS, voice, Salesforce, schedules, and human escalation all route into the same customer actor. The actor is the customer — not a conversation, not a session.

## Why Telnyx

Telnyx is AI Communications Infrastructure — a single platform for voice, SMS, and AI inference. This example demonstrates how Edge Compute's Agent SDK provides the durable substrate (per-customer state, message history, scheduled tasks) while LangGraph provides the reasoning loop, all with zero-credential inference through the Telnyx API binding.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /v2/messages` (via binding) | Send outbound SMS replies to the customer |
| `POST /v2/ai/openai/chat/completions` (via binding) | Zero-credential LLM inference for the LangGraph nodes |
| `GET /v2/public_key` | Fetch the Ed25519 public key for webhook signature verification |
| `message.received` webhook | Inbound SMS webhook that triggers the per-customer actor |

## Architecture

```
SMS webhook (message.received)
  └─> src/index.ts fetch()
        • verify Ed25519 signature via telnyx SDK
        • normalize phone → E.164
        • route to CustomerAgent actor by phone ("customer-<digits>")
        • return 200 immediately (30s budget)

  CustomerAgent.receive()           ← inbound, ~ms, per-customer actor
        • dedupe by eventId
        • set state.phone_e164 = from (customer identity)
        • append to durable state.history
        • bump turn counter
        • queue("process") → ack webhook

  CustomerAgent.process()           ← queued task, minutes of budget
        • stale-task no-op guard (turn ≤ lastSentTurn → return)
        • state.history → BaseMessage[]
        • LangGraph StateGraph: intent → action → response
              intent   : TelnyxBoundChatModel.classify(history)
              action   : lookupOrder(orderId) — Salesforce-shaped tool, mockable locally
              response : TelnyxBoundChatModel.reply(history, actionResult)
        • stage pendingOutbound → send SMS → commit lastSentTurn
        • append assistant reply to state.history
        • re-queue if newer turn arrived during processing
        • schedule 24h nudge

  CustomerAgent.getContext()        ← debug route, /context
        • full CustomerState + history
        • proves same-phone durability across requests

  POST /webhooks/salesforce         ← Salesforce status webhook
        • route by phone_e164 to the same CustomerAgent
        • update Salesforce through the tool layer
        • merge shipment status into durable CustomerState
        • record the proactive SMS step

  TelnyxBoundChatModel              ← the zero-credential adapter
        • extends SimpleChatModel (LangChain)
        • _call() maps messages → {role, content}[]
        • calls this.env.TELNYX.ai.openai.chat.createCompletion()
        • no API key in code, bundle, or logs
```

### CustomerAgent is the durable entity

The actor is keyed by the customer's normalized E.164 phone number (`customer-<digits>`). Every inbound — inbound SMS, outbound SMS, future voice call, future Salesforce webhook, future self-waking schedule — is routed to the same `CustomerAgent` instance. The durable `CustomerState` is the customer's truth:

| Field | Purpose |
|-------|---------|
| `phone_e164` | Customer's E.164 phone (the actor key) |
| `name` | Customer name (seeded from env for the demo) |
| `salesforce_id` | Mock Salesforce ID until Gate 4 (`mock-anusha-salesforce-id`) |
| `preferred_channel` | `sms` or `voice` |
| `proactive_consent` | Whether the customer has consented to outbound pings |
| `open_tickets` | Salesforce Case refs (empty in Gate 1) |
| `shipments` | Shipment refs (empty in Gate 1) |
| `escalation_pending` | Active HITL escalation, or `null` |
| `active_schedule_ids` | Self-scheduled wakes the actor has queued |
| `history` | Durable message log (parallel write to `this.messages`) |
| `turn`, `queuedTurn`, `processingTurn`, `lastSentTurn` | Per-actor SMS coordination |
| `pendingOutbound` | Staging record for at-least-once SMS send |
| `lastIntent` | Most recent LangGraph intent label |

> **Phone mismatch:** if an inbound SMS arrives at an actor whose bound `phone_e164` differs from the inbound `from`, the actor logs a `phone_mismatch` phase. In production, two distinct phones route to two distinct actors — this guard surfaces that anomaly.

### Three state layers (the key concept)

| Layer | API | Scope | Used for |
|-------|-----|-------|----------|
| LangGraph graph state | `StateGraph` channels | Ephemeral, one `process()` run | `intentLabel`, `actionResult`, `replyText` |
| Agent SDK durable state | `this.setState()` / `this.getState()` | Durable, per actor | `CustomerState` — the customer truth |
| Agent SDK message history | `this.messages.add()` / `.toLangChain()` | Durable, per actor | LangChain `BaseMessage[]` for graph nodes |

### Turn state machine (at-least-once safety)

The turn state machine prevents duplicate replies under retry and concurrent inbound messages:

| Field | Purpose |
|-------|---------|
| `turn` | Monotonic counter, incremented on each inbound |
| `queuedTurn` | The turn we want `process()` to handle next |
| `processingTurn` | The turn currently being processed |
| `lastSentTurn` | Highest turn for which SMS send resolved successfully |
| `pendingOutbound` | Staging record `{turn, reply, clientRef}` before send |

**Stale-task no-op:** if `queuedTurn ≤ lastSentTurn`, `process()` returns immediately.
**Per-turn idempotency:** the guard is on `turn`, not reply text, so identical legitimate replies across different turns are not suppressed.

> **At-least-once note:** Telnyx `POST /messages` does not expose a wire-side idempotency key. A crash in the sub-millisecond window between send-ack and `setState({lastSentTurn})` can produce one duplicate. The `lastSentTurn` commit is the last durable write after send to minimize this window.

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `TELNYX_API_KEY` | Fetch the Ed25519 public key for webhook verification. NOT used for LLM inference. | Yes (production) |
| `TELNYX_PUBLIC_KEY` | Ed25519 public key stored as an Edge secret. Fetched via `telnyx-edge secrets add`. | Yes (production) |
| `MODEL` | LLM model ID. Docs-indicated default: `zai-org/GLM-5.2`. Must be a model the binding serves. | No (defaults to `zai-org/GLM-5.2`) |
| `DEMO_MODE` | `"true"` serves a local HTML test UI at `/`. `"false"` disables it. | No (defaults to `true`) |
| `SMS_TRANSPORT` | `"demo"` simulates outbound SMS in the event log. Any other value sends real SMS via the binding. | No (defaults to production on Edge; local harness sets `demo`) |
| `DEMO_FROM_NUMBER` | The agent's phone number (E.164) for the demo UI. | No (defaults to `+15551234567`) |
| `DEMO_SENDER_NUMBER` | The simulated customer's phone number (E.164) — the actor's identity. | No (defaults to `+15557654321`) |
| `DEMO_CUSTOMER_NAME` | Seed name for the demo customer's `CustomerState`. | No (defaults to `Anusha`) |
| `DEMO_CUSTOMER_SALESFORCE_ID` | Seed Salesforce ID for the demo customer's `CustomerState`. | No (defaults to `mock-anusha-salesforce-id`) |
| `USE_MOCK_SALESFORCE` | `"true"` keeps Salesforce reads/writes in the mock client. Real Salesforce arrives in Gate 4. | No (defaults to `true`) |
| `SF_CLIENT_ID` | Salesforce Connected App consumer key for OAuth2 client credentials. | Yes when `USE_MOCK_SALESFORCE=false` |
| `SF_CLIENT_SECRET` | Salesforce Connected App consumer secret for OAuth2 client credentials. | Yes when `USE_MOCK_SALESFORCE=false` |
| `SF_DOMAIN` | `login`, `test`, a Salesforce My Domain prefix, or a full `https://...` login URL. | No (defaults to `login`) |
| `SF_API_VERSION` | Salesforce REST API version. | No (defaults to `v58.0`) |

> **Which secrets do I need?** You need `TELNYX_PUBLIC_KEY` (for webhook signature verification). You do NOT need an inference `TELNYX_API_KEY` — the Edge binding is pre-authenticated. "Zero-credential" means no inference API key in code, bundle, or logs.
>
> **Salesforce locally:** mock mode is implemented for order/shipment reads and shipment status writes. Real mode uses OAuth2 client credentials, but should be validated against Anusha's Salesforce org before enabling in production.

> **Agent / CLI access:** Provision the messaging webhook with the Telnyx CLI:
>
> ```bash
> telnyx messaging-profiles create --name "persistent-state-agent" \
>   --webhook-url "https://persistent-state-agent-<your-org>.telnyxcompute.com/webhooks/messaging"
>
> telnyx phone-numbers assign --phone-number "+1YOUR_NUMBER" \
>   --messaging-profile-id "$MESSAGING_PROFILE_ID"
> ```
>
> The simulated customer's phone (`DEMO_SENDER_NUMBER`) is the actor key; the agent's number (`DEMO_FROM_NUMBER`) is the `from:` for outbound SMS.

## Setup

### 1. Clone and install

```bash
cd telnyx-code-examples/persistent-state-agent
npm install
```

### 2. Fetch the public key and store it as a secret

```bash
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
```

### 3. Run the demo locally

```bash
npm run typecheck   # verify TypeScript compiles
npm test             # run the test suite
npm run local:dev    # start local HTTP harness at http://localhost:8787
```

The local harness does not use Edge actors. It provides an in-memory actor namespace and mock Telnyx binding so you can test `/send`, `/events`, `/context`, and `/webhooks/salesforce` before Edge is healthy.

In another terminal:

```bash
curl -sS http://localhost:8787/health

curl -sS -X POST http://localhost:8787/send \
  -H "content-type: application/json" \
  -d '{"from":"+15557654321","text":"where is order ORD-10042?"}'

curl -sS "http://localhost:8787/events?from=%2B14157986793&limit=20"

curl -sS "http://localhost:8787/context?phone=%2B14157986793"

curl -sS -X POST http://localhost:8787/webhooks/salesforce \
  -H "content-type: application/json" \
  -d '{
    "phone_e164": "+15557654321",
    "order_id": "ORD-10043",
    "salesforce_id": "SHP-002",
    "status": "delayed",
    "estimated_delivery": "Wednesday"
  }'

curl -sS "http://localhost:8787/context?phone=%2B14157986793"
```

### 4. Deploy to Edge Compute

```bash
# Scaffold a function ID (first time only):
telnyx-edge new-func --actor --name=persistent-state-agent

# Update telnyx.toml with the generated func_id, then:
telnyx-edge types   # generate binding types
telnyx-edge ship     # deploy
```

### 5. Smoke test the model (deploy-time verification)

After `telnyx-edge ship`, verify the binding serves the configured model before pointing real SMS traffic:

```bash
# Option A: demo mode smoke — hit the demo UI at the function URL, send "where is order ORD-10042?"
# Option B: production smoke — send a real SMS to your Telnyx number with the same text
```

**If the smoke returns a 422 / model-not-found**, the binding doesn't serve `MODEL` with that exact ID. Switch to the FP8 variant and re-ship:

```bash
MODEL=zai-org/GLM-5.2-FP8
telnyx-edge ship
```

| Model ID | When to use |
|----------|-------------|
| `zai-org/GLM-5.2` | Default. Telnyx's Available Models docs list this as a Chat Completions model. Try this first. |
| `zai-org/GLM-5.2-FP8` | Fallback if `zai-org/GLM-5.2` returns 422 on the binding. |

This is a runtime model-string verification, not a deployment blocker. `MODEL` is configurable via env var — no code change needed to switch.

### 6. Point the SMS webhook

In the Telnyx Mission Control Portal, set your messaging profile's webhook URL to:
```
https://persistent-state-agent-<your-org>.telnyxcompute.com/webhooks/messaging
```

### 7. Test

- **Demo mode:** Visit the function URL in your browser for a local HTML chat UI showing the customer's `CustomerState`.
- **Production:** Send an SMS to your Telnyx number from the configured demo customer phone. The same actor handles every follow-up.

## API Reference

See [API.md](API.md) for the full typed endpoint reference.

### Local Salesforce Webhook Shape

```bash
curl -X POST http://localhost:8787/webhooks/salesforce \
  -H "content-type: application/json" \
  -d '{
    "phone_e164": "+15557654321",
    "order_id": "ORD-10043",
    "salesforce_id": "SHP-002",
    "status": "delayed",
    "estimated_delivery": "Wednesday"
  }'
```

In `USE_MOCK_SALESFORCE=true`, this updates the local mock shipment, merges the shipment into the customer's durable state, and records the proactive SMS as mocked.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `TELNYX_PUBLIC_KEY is required` | Run `telnyx-edge secrets add TELNYX_PUBLIC_KEY` and re-ship. |
| Webhook returns 401 | Signature verification failed. Ensure the public key matches your org's key from `GET /v2/public_key`. |
| No SMS reply in demo mode | `SMS_TRANSPORT=demo` simulates sends in the event log. Set `SMS_TRANSPORT=production` for real SMS. |
| Model returns 422 | The model ID in `MODEL` may not be served by the binding. Default is `zai-org/GLM-5.2`; fallback is `zai-org/GLM-5.2-FP8`. Set `MODEL` env var and re-ship. See [Smoke test the model](#5-smoke-test-the-model-deploy-time-verification). |
| Duplicate SMS on retry | This is the at-least-once window (see Architecture). The `lastSentTurn` guard minimizes it. |
| `from must be E.164` | The inbound `from.phone_number` is not a valid E.164 (missing `+` or wrong length). Fix the originating number or the webhook source. |
| Two SMS from one phone go to two actors | That would mean the phone is being normalized to two different strings. Check `DEMO_SENDER_NUMBER` matches the inbound `from` exactly, including country code. |

## Related Examples

- [agent-with-tool-calling](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-with-tool-calling/README.md) — Agent SDK with LLM tool calling (ReAct pattern)
- [multi-turn-sms-quiz-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-turn-sms-quiz-agent/README.md) — Multi-turn SMS quiz with durable state
- [sentiment-analysis-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sentiment-analysis-agent/README.md) — Sentiment analysis with the Agent SDK

## Resources

- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk) — the `Agent` base class, message history, state, and scheduled tasks
- [Calling LLMs](https://developers.telnyx.com/docs/agent-sdk/concepts/calling-llms) — both wiring patterns (roll your own + bring a framework)
- [LangGraph Agent example](https://developers.telnyx.com/docs/agent-sdk/examples/langgraph) — the official docs example (uses ChatOpenAI+key; this sample improves on it with the zero-credential binding)
- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) — getting started with Edge functions
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api) — pre-authenticated Telnyx client for your function
- [Webhook signing](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks) — Ed25519 signature verification
- [Telnyx SDK](https://developers.telnyx.com/development/sdk) — official SDKs for all languages
- [AI Communications Infrastructure](https://telnyx.com) — Telnyx product page
- [Pricing](https://telnyx.com/pricing) — Telnyx pricing

## Agent Discovery

This example is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: Per-customer durable `CustomerAgent` actor running LangGraph `StateGraph` (intent → action → response) on Telnyx Edge Compute with zero-credential LLM inference via the Telnyx API binding. The actor is the customer, not the conversation.
- **Runtime**: Node.js on Telnyx Edge Compute Stateful Actors (Agent SDK).
- **Primary APIs**: Telnyx Inference (via pre-authenticated binding), Telnyx Messaging (SMS via binding), actor-local SQL for process logging, Ed25519 webhook verification.
- **Entry point**: `src/index.ts` — fetch handler that verifies signatures and routes to the `CustomerAgent` actor by normalized E.164 phone number (`customer-<digits>`).
- **Customer state**: `src/customer-agent.ts` — durable `CustomerState` (`phone_e164`, `name`, `salesforce_id`, `preferred_channel`, `proactive_consent`, `open_tickets`, `shipments`, `escalation_pending`, `active_schedule_ids`, `history`, turn state machine) is the customer's truth.
- **Debug route**: `GET /context?phone=<e164>` — returns the full `CustomerContext` (state + history) for verification.
- **Graph**: `src/graph.ts` — 3-node `StateGraph` (intent → action → response) with conditional routing; `intent` and `response` nodes call `TelnyxBoundChatModel`, `action` is plain TS.
- **Zero-credential adapter**: `src/telnyx-bound-chat-model.ts` — `SimpleChatModel` subclass that calls `this.env.TELNYX.ai.openai.chat.createCompletion()` (no API key in code, bundle, or logs).
