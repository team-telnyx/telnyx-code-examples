# Clinic Triage & Handoff — Developer Guide

This guide walks you through the `clinic-triage-handoff` sample: a **durable routing actor** that classifies inbound callers, hands them off to the right specialist sub-agent with full conversation context, recovers from misroutes, and routes return callers by history.

---

## Prerequisites

- A Telnyx account with an Edge Compute environment provisioned
- `telnyx-edge` CLI installed and authenticated (`telnyx-edge auth api-key set <KEY>`)
- Node.js 20+ and `npx tsx` available for running the smoke test
- An OpenAI-compatible model endpoint configured in your Telnyx AI binding
- A clinic phone number in E.164 format (e.g. `+15551000000`)

---

## Project Structure

```
clinic-triage-handoff/
├── src/
│   └── index.ts          # Main entry: TriageRouter + sub-agents
├── smoke_test.ts         # Verifies classes/methods exist and idempotency guards
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
└── .gitignore
```

---

## Environment Setup

### 1. Configure `telnyx.toml`

The `telnyx.toml` declares all bindings. The key ones for this sample:

```toml
name = "clinic-triage-handoff"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "TRIAGE_ROUTER"
type    = "TriageRouter"

[[actors]]
binding = "BILLING_AGENT"
type    = "BillingAgent"

[[actors]]
binding = "CLINICAL_AGENT"
type    = "ClinicalAgent"

[[actors]]
binding = "AFTERHOURS_AGENT"
type    = "AfterHoursAgent"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.ROUTING_DB]
id = "<sqldb-namespace-uuid>"

[env_vars]
AI_MODEL = "gpt-4o-mini"
CLINIC_LINE_E164 = "+15551000000"
DEMO_MODE = "true"
```

### 2. Set secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
```

### 3. Generate type definitions

```bash
telnyx-edge types
```

This regenerates `telnyx-env.d.ts` from your `telnyx.toml` bindings so TypeScript knows about `this.env.TELNYX`, `this.env.ROUTING_DB`, etc.

### 4. `.env.example`

```
TELNYX_API_KEY=your_telnyx_api_key_here
AI_MODEL=gpt-4o-mini
CLINIC_LINE_E164=+15551000000
DEMO_MODE=true
```

---

## How It Works — Step by Step

### Step 1: The Actor is Born on First Call

When a caller dials the clinic line, Telnyx sends a `call-initiated` webhook to the Edge function. The `fetch` handler in `TriageRouter` (the main entry point) receives it.

The router actor is **self-provisioned** — it's born via `env.TRIAGE_ROUTER.idFromName(lineE164)` on the first `call-initiated` for that clinic line. One durable router per line, surviving across callers and days.

Inside `fetch`, the handler:
1. Parses the webhook body to extract `call_control_id`, `from`, `to`, and `transcript`
2. Ensures the `routing` SQL table exists (`CREATE TABLE IF NOT EXISTS`)
3. Calls `this.onCall(call)`

### Step 2: Intent Classification (STT + LLM)

`onCall` first checks the **idempotency guard** — it queries the `routing` table for an existing row with `done = 1` for this `callId`. If found, it returns immediately (redelivered webhooks don't double-log).

If not already routed, it calls `classifyIntent()`:

```typescript
const { intent } = await classifyIntent(
  this.env.TELNYX,
  this.env.AI_MODEL,
  call.transcript
);
```

This uses the **Telnyx AI binding** (`this.env.TELNYX.ai.openai.chat.createCompletion`) — zero-credential, the platform injects auth. The LLM classifies the transcript into `"billing"`, `"clinical"`, or `"afterhours"`.

### Step 3: Log the Routing Row (Exactly Once)

The router inserts a row into the `routing` SQL table:

```sql
INSERT INTO routing(line, caller, callId, intent, dest, ts, done) VALUES(?,?,?,?,?,?,0)
```

This is the **per-caller routing log** — the memory that makes return-callers route smarter. The `done` flag starts at `0` (not yet transferred).

### Step 4: Schedule the Handoff (Idempotent)

Instead of transferring immediately, the router **schedules** the handoff:

```typescript
await this.schedule(0, "handoff", { call, intent }, { taskId: `route:${call.callId}` });
```

The `taskId: route:${call.callId}` makes this **idempotent under re-activation**. If the worker is killed mid-handoff, the next webhook re-activates the actor and the scheduled task resumes — the transfer completes exactly once.

### Step 5: The Handoff — Context-Preserving Transfer

The `handoff` method:
1. Re-checks the `done` guard (double protection against double-transfer)
2. Calls `summarizeTranscript()` to generate a 1–2 sentence summary via the same OpenAI binding
3. Builds a `HandoffPayload`:

```typescript
const payload: HandoffPayload = {
  caller: call.from,
  transcript: call.transcript,
  intent,
  summary,
};
```

4. Calls `this.transferTo(intent, call, payload)` — which executes the **Call Control transfer** with `client_state` containing the base64-encoded payload. The destination sub-agent receives this context and **already knows the caller's issue** — no re-intake.
5. Marks the routing row `done = 1`

### Step 6: Sub-Agent Receives Context

The destination sub-agent (e.g. `BillingAgent`) receives the handoff payload via its `onHandoff` method:

```typescript
async onHandoff(payload: HandoffPayload): Promise<void> {
  const greeting = `Hi, I'm the billing specialist. I see you were calling about ${payload.intent}. ${payload.summary}`;
  // ...
}
```

The billing agent's opening line **references the caller's already-stated issue** — proving context preservation. In demo mode, it logs the greeting; in live mode, it would use Call Control TTS to speak it.

### Step 7: Misroute Recovery

If the billing agent determines the caller was misrouted, it calls `onMisroute(callId, reason)` on the router:

```typescript
async onMisroute(callId: string, reason: string): Promise<void> {
  const row = await this.env.ROUTING_DB
    .prepare("SELECT * FROM routing WHERE callId = ? ORDER BY ts DESC LIMIT 1")
    .bind(callId)
    .all();
  // ... reclassify and re-handoff with combined transcript
}
```

The router re-wakes, reclassifies the combined transcript, and re-handoffs to the correct sub-agent — again with full context. The `route:${callId}:retry` task ID ensures this retry is also idempotent.

### Step 8: Return-Caller Routing (Next Day)

When the same caller dials back:

```typescript
async routeForReturn(caller: string): Promise<string | null> {
  const row = await this.env.ROUTING_DB
    .prepare("SELECT intent, dest FROM routing WHERE caller = ? ORDER BY ts DESC LIMIT 1")
    .bind(caller)
    .all();
  // ...
}
```

The router reads its `routing` log: "last time you were handled by billing, then clinical" → routes straight to clinical first, with prior context.

### Step 9: Restart Proof

If the Edge worker is killed between classify and transfer:
- The `route:${callId}` scheduled task is durable — it re-activates on the next webhook
- The `done` guard prevents double-logging or double-transferring
- The caller is never dropped

---

## Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK** (`Agent<Env, RouterState>`) | `TriageRouter` extends `Agent` — the durable routing brain |
| **Call Control** | `TELNYX.calls.transfer()` for context-carrying handoff; `TELNYX.calls.answer()` in sub-agents |
| **Inference** | `TELNYX.ai.openai.chat.createCompletion()` for intent classification + summary generation |
| **SQL StateStore** | `ROUTING_DB` — the `routing(line, caller, callId, intent, dest, ts, done)` per-caller log |
| **Task Scheduler** | `this.schedule(0, "handoff", ..., { taskId: "route:<callId>" })` — idempotent, restart-safe handoff |
| **Multi-agent handoff** | Billing/Clinical/AfterHours sub-agents receive handoff payloads with full transcript context |

---

## Demo Mode vs Live Mode

The sample runs in **demo mode by default** (`DEMO_MODE=true`):

- **Demo mode**: No real calls are placed, no real transfers executed. The router logs what it *would* do:
  ```
  [DEMO] Handoff to billing for caller +15551234567
  [DEMO] Payload: {"caller":"+15551234567","transcript":"...","intent":"billing","summary":"..."}
  ```
  Sub-agents log their greeting instead of speaking it via TTS.

- **Live mode**: Set `DEMO_MODE=false` (or unset it). The router executes real Call Control transfers via `TELNYX.calls.transfer()` with `client_state` containing the handoff payload. Sub-agents use `TELNYX.calls.answer()` to connect.

To switch:
```bash
telnyx-edge secrets add DEMO_MODE "false"
telnyx-edge ship
```

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies:
- `TriageRouter`, `BillingAgent`, `ClinicalAgent`, `AfterHoursAgent` classes exist
- `classifyIntent`, `summarizeTranscript`, `HandoffPayload` are exported
- Idempotency guards (`done` flag check) are present in `onCall` and `handoff`
- `routeForReturn` and `onMisroute` methods exist

---

## Deployment

```bash
telnyx-edge ship
```

This deploys the actor to Telnyx Edge. The `TRIAGE_ROUTER` actor binding is automatically provisioned — one durable instance per clinic line via `idFromName(lineE164)`.

---

## Next Steps

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors on Telnyx Edge](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Call Control Transfer API](https://developers.telnyx.com/docs/voice/programmable-voice/call-control-transfer)
- [Gather Using AI (STT)](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Telnyx AI Binding (OpenAI)](https://developers.telnyx.com/docs/ai)
- [LiveKit Agents Handoffs](https://docs.livekit.io/agents/logic/agents-handoffs/) — the pattern this sample rebuilds as a durable actor
- [Vapi Warm Transfer](https://docs.vapi.ai/assistants/examples/support-escalation/) — the per-call equivalent this sample improves upon
- [DEV-823: Voice IVR with Agent Backend](https://linear.app/telnyx/issue/DEV-823/sprint-2-voice-ivr-with-agent-backend) — the per-call IVR this sample is distinct from
