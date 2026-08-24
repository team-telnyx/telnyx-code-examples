# Persistent State Agent on Edge

A voice-first durable customer agent on Telnyx Edge Compute. The actor is the persistent agent state for one customer, keyed by the customer's phone number. A LangGraph orchestrator runs inside the actor, coordinating Salesforce CRM, AgentMail SDR confirmation, and outbound SMS. The same actor survives across voice calls, Salesforce changes, email replies, time, and channel switches — the customer's workflow never dies.

## Why Telnyx

Telnyx is AI Communications Infrastructure — a single platform for voice, SMS, and AI inference. This example demonstrates how Edge Compute's Agent SDK provides the durable substrate (per-customer state, message history) while LangGraph provides the reasoning loop, all with zero-credential inference through the Telnyx API binding.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /v2/messages` (via binding) | Send outbound SMS to the customer (meeting confirmations, reschedule notifications) |
| `POST /v2/ai/openai/chat/completions` (via binding) | Zero-credential LLM inference for the LangGraph nodes |
| `GET /v2/public_key` | Fetch the Ed25519 public key for webhook signature verification |
| `message.received` webhook | Inbound SMS webhook (secondary path; voice is primary) |
| AI Assistant dynamic variables webhook | Call-start context retrieval for returning callers |
| AI Assistant webhook tool | Call-end result ingestion from the Responder |

## Architecture

```
                    Phone number
                         |
                    normalize → E.164
                         |
              customer-<digits> (actor key)
                         |
          ┌──────────────┴──────────────┐
          │     CustomerAgent actor     │
          │   (durable, per-customer)    │
          │                             │
          │  CustomerState (truth)      │
          │  ├── phone_e164             │
          │  ├── name                   │
          │  ├── latest_lead            │
          │  ├── meeting_time            │
          │  ├── assigned_sdr            │
          │  ├── reschedule_event        │
          │  ├── history[]              │
          │  └── ...                    │
          │                             │
          │  LangGraph Orchestrator     │
          │  ├── getCallContext()       │
          │  ├── ingestCallResult()     │
          │  ├── ingestSdrReply()       │
          │  └── ingestSalesforceChange()│
          │                             │
          └──┬──────┬──────┬──────┬─────┘
             │      │      │      │
          Voice   SMS   SF    AgentMail
```

### Component responsibilities

| Component | Owns | Does NOT own |
|-----------|------|--------------|
| **Telnyx AI Assistant (Responder)** | Live voice, identity capture, context handoff | Long-term state, Salesforce, SMS |
| **CustomerAgent actor (Orchestrator)** | Durable state, reasoning, Salesforce, AgentMail, SMS, reschedule detection | Live voice conversation |
| **Salesforce** | Lead ID, CRM fields, SDR assignment, meeting time/status | Reasoning, SMS, email |
| **AgentMail** | SDR confirmation email loop | Customer-facing SMS |
| **SMS** | Meeting confirmations + proactive reschedule notifications | Voice, email |

### Flow 1 — First voice call

```
1. Customer calls the Telnyx number
2. Responder answers, collects name + email + phone
3. Responder calls send_call_result tool → POST /ai-assistant
4. ingestCallResult() in the actor:
   ├── createOrUpdateLead() in Salesforce
   ├── assignSdr() → Steve assigned
   ├── checkSdrAvailability()
   ├── emailSdrForConfirmation() via AgentMail
   └── send confirmation SMS to customer
```

### Flow 2 — AgentMail SDR confirmation

```
5. Steve replies "Yes" to the AgentMail email
6. AgentMail webhook → /webhooks/email → ingestSdrReply()
   ├── updateLeadMeeting() in Salesforce (Meeting_Status=confirmed, SDR_Approval=confirmed)
   └── send confirmation SMS to customer
```

### Flow 3 — Salesforce manual reschedule

```
7.  Steve manually changes Meeting_Time__c in Salesforce
8.  Salesforce Flow fires → POST /webhooks/salesforce-lead-change
9.  ingestSalesforceLeadChange() in the same actor:
    ├── compare old vs new meeting time
    ├── persist reschedule_event (status: pending_customer_ack)
    └── send proactive SMS: "your meeting has been moved to <new time>"
```

### Flow 4 — Returning voice call

```
10. Customer calls again (confused by the change)
11. Responder requests context → GET /call/context (dynamic variables webhook)
12. getCallContext() returns:
    ├── customer name, phone, Salesforce Lead ID
    ├── assigned SDR = Steve
    ├── original meeting time
    ├── new meeting time (from reschedule)
    ├── salesforce_manually_changed = true
    ├── proactive_sms_sent = true
    └── likely_reason_for_call (narrative summary)
13. Responder opens: "Hi Jane, I see your meeting with Steve was moved to Thursday at 11. Is that what you're calling about?"
14. Customer confirms → send_call_result with intent=confirm_reschedule
15. Actor updates Salesforce (Customer_Approval=confirmed) and marks reschedule acknowledged
```

### Durable CustomerState

The actor is keyed by the customer's normalized E.164 phone number (`customer-<digits>`). The durable `CustomerState` is the customer's truth:

| Field | Purpose |
|-------|---------|
| `phone_e164` | Customer's E.164 phone (the actor key) |
| `name` | Customer name |
| `latest_lead` | Salesforce Lead ref (id, meeting_time, meeting_status, assigned_sdr, sdr_confirmation) |
| `reschedule_event` | Active reschedule (old/new time, detected_at, proactive_sms_sent, status) |
| `preferred_channel` | `sms` or `voice` |
| `proactive_consent` | Whether the customer has consented to outbound pings |
| `history` | Durable message log |
| `lastIntent` | Most recent intent label |

### Three state layers

| Layer | API | Scope | Used for |
|-------|-----|-------|----------|
| LangGraph graph state | `StateGraph` channels | Ephemeral, one run | `intentLabel`, `actionResult`, `replyText` |
| Agent SDK durable state | `this.setState()` / `this.getState()` | Durable, per actor | `CustomerState` — the customer truth |
| Agent SDK message history | `this.messages.add()` / `.toLangChain()` | Durable, per actor | LangChain `BaseMessage[]` for graph nodes |

## Reliability Details

### Webhook deduplication

Every inbound webhook is deduplicated by `eventId` via a `webhook_events` SQL table with a `PRIMARY KEY` constraint. Duplicate webhooks are silently dropped. Voice call lifecycle events are deduplicated via a separate `call_lifecycle_events` table.

### Turn state machine (at-least-once SMS)

The turn state machine prevents duplicate SMS under retry and concurrent inbound messages:

| Field | Purpose |
|-------|---------|
| `turn` | Monotonic counter, incremented on each inbound |
| `queuedTurn` | The turn we want `process()` to handle next |
| `processingTurn` | The turn currently being processed |
| `lastSentTurn` | Highest turn for which SMS send resolved successfully |

**Stale-task no-op:** if `queuedTurn ≤ lastSentTurn`, `process()` returns immediately.

> **At-least-once note:** Telnyx `POST /messages` does not expose a wire-side idempotency key. A crash between send-ack and `setState({lastSentTurn})` can produce one duplicate. The `lastSentTurn` commit is the last durable write after send to minimize this window.

### Webhook signature verification

Inbound SMS webhooks are verified using the Telnyx Ed25519 public key (`TELNYX_PUBLIC_KEY` stored as an Edge secret). AgentMail webhooks are verified using Svix signatures (`AGENTMAIL_WEBHOOK_SECRET`). The `/ai-assistant` and `/webhooks/salesforce-lead-change` endpoints are unauthenticated for demo simplicity.

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
| `DEMO_CUSTOMER_NAME` | Seed name for the demo customer's `CustomerState`. | No (defaults to `Jane`) |
| `DEMO_CUSTOMER_SALESFORCE_ID` | Seed Salesforce ID for the demo customer's `CustomerState`. | No (defaults to `mock-demo-salesforce-id`) |
| `USE_MOCK_SALESFORCE` | `"true"` keeps Salesforce reads/writes in the mock client. Set to `"false"` with real credentials for production. | No (defaults to `true`) |
| `SF_CLIENT_ID` | Salesforce Connected App consumer key for OAuth2 client credentials. | Yes when `USE_MOCK_SALESFORCE=false` |
| `SF_CLIENT_SECRET` | Salesforce Connected App consumer secret for OAuth2 client credentials. | Yes when `USE_MOCK_SALESFORCE=false` |
| `SF_DOMAIN` | `login`, `test`, a Salesforce My Domain prefix, or a full `https://...` login URL. | No (defaults to `login`) |
| `SF_API_VERSION` | Salesforce REST API version. | No (defaults to `v58.0`) |
| `SDR_EMAIL` | Email address for the SDR confirmation email (AgentMail loop). | No (defaults to `sdr@example.com`) |
| `SDR_NAME` | SDR display name used in emails and SMS. | No (defaults to `Steve`) |
| `AGENTMAIL_API_KEY` | AgentMail API key for sending outbound SDR confirmation emails. | Yes for AgentMail loop |
| `AGENTMAIL_INBOX` | AgentMail inbox address used as the `from` for outbound emails. | Yes for AgentMail loop |
| `AGENTMAIL_WEBHOOK_SECRET` | Svix webhook secret for verifying inbound AgentMail replies. | Yes for AgentMail loop |

> **Which secrets do I need?** You need `TELNYX_PUBLIC_KEY` (for webhook signature verification). You do NOT need an inference `TELNYX_API_KEY` — the Edge binding is pre-authenticated. "Zero-credential" means no inference API key in code, bundle, or logs.
>
> **Salesforce:** mock mode is implemented for lead reads/writes. Real mode uses OAuth2 client credentials. Set `USE_MOCK_SALESFORCE=false` and provide `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, and `SF_DOMAIN` to connect your Salesforce org.
>
> **AgentMail:** set `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX`, and `AGENTMAIL_WEBHOOK_SECRET` to enable the SDR confirmation email loop. Set `SDR_EMAIL` to the address where you want to receive the confirmation email.
>
> **Salesforce reschedule Flow:** see [SALESFORCE_FLOW_SETUP.md](SALESFORCE_FLOW_SETUP.md) for instructions on configuring a Salesforce record-triggered Flow that calls the reschedule webhook when `Meeting_Time__c` changes.

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

# Simulate a call result from the AI Assistant
curl -sS -X POST http://localhost:8787/ai-assistant \
  -H "content-type: application/json" \
  -d '{"caller_phone":"+15557654321","intent":"schedule_meeting","customer_name":"Jane","customer_email":"jane@example.com","customer_phone":"+15557654321","requested_meeting_time":"Thursday at 9:00 AM","transcript_summary":"Jane wants a sales meeting"}'

# Check the customer's context (what the Responder would receive on the next call)
curl -sS "http://localhost:8787/call/context?from=%2B15557654321"

# Simulate a Salesforce reschedule
curl -sS -X POST http://localhost:8787/webhooks/salesforce-lead-change \
  -H "content-type: application/json" \
  -d '{"phone_e164":"+15557654321","lead_id":"00Q-demo","meeting_time":"Friday at 1:00 PM","meeting_status":"Rescheduled by SDR","assigned_sdr":"Steve"}'

# Verify the reschedule event is in the actor state
curl -sS "http://localhost:8787/context?phone=%2B15557654321"
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

After `telnyx-edge ship`, verify the binding serves the configured model:

```bash
# Hit the health endpoint to verify deployment
curl -sS https://your-function-name.telnyxcompute.com/health
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

### 6. Configure the AI Assistant

Create a Telnyx AI Assistant in Mission Control with:
- **Dynamic variables webhook URL**: `https://your-function-name.telnyxcompute.com/ai-assistant` (timeout: 8000ms)
- **Webhook tool `send_call_result`**: same URL, with body parameters for `caller_phone`, `intent`, `customer_name`, `customer_email`, `customer_phone`, `requested_meeting_time`, `transcript_summary`
- **Greeting**: `{{greeting_text}}` (the Edge function computes this based on caller context)

Assign your Telnyx phone number to the assistant's TeXML application.

### 7. Test

- **Demo mode:** Visit the function URL in your browser for a local HTML chat UI showing the customer's `CustomerState`.
- **Voice:** Call your Telnyx number. The AI Assistant answers, collects your info, and offers meeting times. After the call, you receive an SMS confirmation and an AgentMail email.
- **AgentMail reply:** Reply "Yes" to the AgentMail email. The actor updates Salesforce and sends a confirmation SMS.
- **Reschedule:** Manually change `Meeting_Time__c` in Salesforce (with the Flow configured). You receive a proactive SMS about the change.
- **Second call:** Call the same number again. The Assistant recognizes you and references the reschedule.

## API Reference

See [API.md](API.md) for the full typed endpoint reference.

### Key endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/ai-assistant` | POST | AI Assistant dynamic variables (call start) + tool calls (call end) |
| `/call/result` | POST | Direct call result ingestion from the Responder |
| `/call/context` | GET | Returning caller context for the Responder |
| `/webhooks/messaging` | POST | Inbound SMS webhook (secondary path) |
| `/webhooks/email` | POST | AgentMail SDR reply webhook |
| `/webhooks/salesforce-lead-change` | POST | Salesforce manual reschedule detection |
| `/context` | GET | Debug: full CustomerState + history |
| `/events` | GET | Debug: conversation, process log, turn state |
| `/health` | GET | Health check |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `TELNYX_PUBLIC_KEY is required` | Run `telnyx-edge secrets add TELNYX_PUBLIC_KEY` and re-ship. |
| Webhook returns 401 | Signature verification failed. Ensure the public key matches your org's key from `GET /v2/public_key`. |
| No SMS received | `SMS_TRANSPORT=demo` simulates sends. Set `SMS_TRANSPORT=production` for real SMS. Also verify `state.to` is set (the agent's phone number). |
| Model returns 422 | The model ID in `MODEL` may not be served by the binding. Default is `zai-org/GLM-5.2`; fallback is `zai-org/GLM-5.2-FP8`. Set `MODEL` env var and re-ship. |
| Salesforce lead not created | Check `USE_MOCK_SALESFORCE` is `"false"` in Edge secrets, not in `telnyx.toml` `[env_vars]`. Verify `SF_CLIENT_ID` and `SF_CLIENT_SECRET` are set. |
| Meeting_Time__c empty in Salesforce | The `toSalesforceDatetime()` parser converts natural language to ISO 8601. Check the process log for `sdr_confirm_salesforce_updated` with `fields=` listing. |
| Reschedule SMS not sent | The Salesforce Flow must call `/webhooks/salesforce-lead-change`. See [SALESFORCE_FLOW_SETUP.md](SALESFORCE_FLOW_SETUP.md). |
| `from must be E.164` | The inbound phone is not valid E.164 (missing `+` or wrong length). Fix the originating number. |

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

- **Use case**: Voice-first durable customer agent on Telnyx Edge Compute. The actor is the persistent agent state for one customer, keyed by phone number. LangGraph orchestrates Salesforce, AgentMail, and SMS across voice calls, time, and channel switches.
- **Runtime**: Node.js on Telnyx Edge Compute Stateful Actors (Agent SDK).
- **Primary APIs**: Telnyx Inference (via pre-authenticated binding), Telnyx Messaging (SMS via binding), AI Assistant dynamic variables + webhook tools, AgentMail (Svix-signed webhooks), Salesforce REST API (OAuth2 client credentials).
- **Entry point**: `src/index.ts` — fetch handler that routes voice call results, SMS webhooks, AgentMail replies, and Salesforce change events to the `CustomerAgent` actor by normalized E.164 phone number.
- **Customer state**: `src/customer-agent.ts` — durable `CustomerState` with `latest_lead`, `reschedule_event`, `history`, and turn coordination.
- **Call context**: `GET /call/context` — returns narrative summary + reschedule flags for the AI Assistant at call start.
- **Call result**: `POST /ai-assistant` — receives `schedule_meeting` and `confirm_reschedule` intents from the AI Assistant.
- **Reschedule detection**: `POST /webhooks/salesforce-lead-change` — compares old vs new meeting time, sends proactive SMS.
- **Graph**: `src/graph.ts` — LangGraph `StateGraph` (intent → action → response) with Salesforce tools.
- **Zero-credential adapter**: `src/telnyx-bound-chat-model.ts` — `SimpleChatModel` subclass that calls `this.env.TELNYX.ai.openai.chat.createCompletion()`.
