---
name: clinic-triage-handoff
title: "Clinic Triage & Handoff — Durable Multi-Agent Router"
description: "A durable Telnyx Edge actor that classifies inbound clinic calls and hands off to billing, clinical, or after-hours sub-agents with full conversation context preserved."
language: typescript
framework: edge
telnyx_products: [Voice, Agent SDK, Edge Compute, AI]
---

# clinic-triage-handoff

A durable Telnyx Edge actor that classifies inbound clinic calls and hands off to billing, clinical, or after-hours sub-agents with full conversation context preserved.

## The Story

A midsize medical clinic in Austin, Texas — Riverbend Family Practice — fields a single inbound phone line for hundreds of patients each day. When a patient calls, the front-desk staff must quickly determine whether the caller needs billing help, has a clinical question, or is reaching out after hours. If the wrong person answers, patients get frustrated, clinical concerns get delayed, and billing disputes escalate — all of which erode trust and, in healthcare, can directly impact patient safety. The clinic cannot afford a generic IVR menu that makes every caller re-explain their issue from scratch.

The actor IS the clinic's triage router. Born the moment a patient dials the clinic's E.164 number, the `TriageRouter` listens to the caller, classifies their intent using an LLM, and hands off to the correct specialist sub-agent — billing, clinical, or after-hours — carrying the full transcript and a summary so the receiving agent already knows what the caller said. If the caller is misrouted, the router re-wakes and re-routes with the combined context. If the same patient calls back the next day, the router reads its persistent routing log and sends them straight to the right team. When the Edge worker reboots mid-handoff, the `route:<callId>` schedule re-activates on the next webhook and the transfer completes exactly once — no dropped calls, no double-transfers, no lost routing rows. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a platform where voice, inference, and stateful compute converge at the edge. Unlike traditional cloud providers that force you to glue together separate services for call control, speech recognition, and durable state, Telnyx's Edge Runtime lets a single actor own the entire call lifecycle: answering the call, gathering audio via `gather-using-ai`, classifying intent with OpenAI through the zero-credential `TELNYX` binding, persisting per-caller routing history in SQL StateStore, and executing a context-carrying transfer — all within a single durable entity that survives worker restarts. This is the infrastructure that makes persistent, intelligent, multi-agent voice routing possible without managing servers, queues, or external databases.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `telnyx.calls.create` | Voice | Initiate outbound calls (sub-agent handoff) |
| `telnyx.calls.answer` | Voice | Answer inbound calls |
| `telnyx.calls.gatherUsingAi` | Voice | Capture caller speech via STT for intent classification |
| `telnyx.calls.transfer` | Voice | Execute context-carrying transfer to destination sub-agent |
| `telnyx.ai.openai.chat.createCompletion` | AI | Intent classification and transcript summarization |
| `env.ROUTING_DB.prepare` | Edge Compute (SQL StateStore) | Persist and query per-caller routing history |
| `this.schedule` | Edge Compute (Agent SDK) | Idempotent handoff scheduling with `route:<callId>` task IDs |
| `env.TRIAGE_ROUTER.idFromName` | Edge Compute (Agent SDK) | Self-provision one durable router per clinic line |

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              Telnyx Edge Runtime             │
                    │                                             │
  Caller ──────────►│  call-initiated webhook                     │
                    │         │                                   │
                    │         ▼                                   │
                    │  ┌─────────────────────┐                    │
                    │  │  TriageRouter Actor  │  ◄── idFromName(lineE164)
                    │  │  (one per clinic line)│                    │
                    │  │                     │                    │
                    │  │  1. onCall(call)    │                    │
                    │  │  2. classifyIntent  │──► OpenAI (TELNYX binding)
                    │  │  3. INSERT routing  │──► SQL StateStore
                    │  │  4. schedule("handoff")                 │
                    │  │     (taskId: route:<callId>)            │
                    │  │                     │                    │
                    │  │  5. handoff()       │                    │
                    │  │  6. summarize       │──► OpenAI (TELNYX binding)
                    │  │  7. transferTo()    │                    │
                    │  │     │               │                    │
                    │  └─────┼───────────────┘                    │
                    │        │                                    │
                    │        │ Call Control transfer              │
                    │        │ (client_state = handoff payload)   │
                    │        ▼                                    │
                    │  ┌─────────────────────┐                    │
                    │  │  BillingAgent       │                    │
                    │  │  ClinicalAgent      │                    │
                    │  │  AfterHoursAgent    │                    │
                    │  │  (sub-agents)       │                    │
                    │  └─────────────────────┘                    │
                    │                                             │
                    │  call-transfer-complete / call-hangup       │
                    │  webhooks                                   │
                    └─────────────────────────────────────────────┘
```

**Data flow:**
1. **Inbound call** → `call-initiated` webhook → `TriageRouter` actor born via `idFromName(lineE164)`.
2. **STT capture** → `gather-using-ai` captures caller speech → transcript passed to `classifyIntent()`.
3. **LLM classification** → OpenAI via `TELNYX.ai.openai.chat.createCompletion()` → intent = `billing` | `clinical` | `afterhours`.
4. **Routing log** → `INSERT INTO routing(...)` persists the route in SQL StateStore (exactly-once via `done` guard).
5. **Handoff** → `schedule("handoff", ..., { taskId: "route:<callId>" })` → `transferTo()` executes Call Control transfer with `client_state` payload (caller, transcript, intent, summary).
6. **Sub-agent receives** → inherits full context — no re-intake.
7. **Misroute recovery** → sub-agent flags misroute → `onMisroute()` re-wakes router → re-routes with combined transcript.
8. **Return caller** → `routeForReturn()` reads routing log → routes by history, not from scratch.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clinic-triage-handoff

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# Generate type bindings from telnyx.toml
npx telnyx-edge types

# Run smoke test
npx tsx smoke_test.ts

# Deploy to Telnyx Edge
npx telnyx-edge ship
```

## API Reference

### `TriageRouter` Actor

The durable routing brain — one instance per clinic line, self-provisioned via `idFromName(lineE164)`.

#### `onCall(call: CallInfo): Promise<void>`

Entry point for inbound calls. Classifies intent, logs the routing row, and schedules the handoff.

**Parameters:**
- `call.callId` — Telnyx call control ID
- `call.from` — Caller's E.164 number
- `call.to` — Dialed number (clinic line)
- `call.transcript` — Captured speech transcript

**Behavior:**
- Checks idempotency guard (`done` flag in routing table)
- Calls `classifyIntent()` to determine destination
- Inserts a row into `routing(line, caller, callId, intent, dest, ts, done)`
- Schedules `handoff()` with `taskId: "route:<callId>"`

#### `handoff(params: { call: CallInfo; intent: string }): Promise<void>`

Executes the context-carrying transfer to the destination sub-agent.

**Behavior:**
- Re-checks `done` guard (double protection)
- Calls `summarizeTranscript()` for a 1–2 sentence summary
- Builds `HandoffPayload` (caller, transcript, intent, summary)
- Calls `transferTo()` to execute the Call Control transfer
- Marks the routing row as `done = 1`

#### `transferTo(dest: string, call: CallInfo, payload: HandoffPayload): Promise<void>`

Executes the actual Call Control transfer.

**Behavior:**
- In demo mode (`DEMO_MODE=true`): logs the handoff, no real transfer
- In live mode: calls `telnyx.calls.transfer()` with `client_state` containing the handoff payload

#### `onMisroute(callId: string, reason: string): Promise<void>`

Re-routes a caller when a sub-agent reports a misroute.

**Behavior:**
- Reads the routing row for the given `callId`
- Re-classifies intent from the combined transcript
- Schedules a new handoff with `taskId: "route:<callId>:retry"`

#### `routeForReturn(caller: string): Promise<string | null>`

Returns the last destination for a returning caller.

**Returns:** The `dest` column from the most recent routing row, or `null` if no history exists.

### `BillingAgent`, `ClinicalAgent`, `AfterHoursAgent`

Sub-agents that receive the handoff payload. Each implements `onHandoff(payload: HandoffPayload)` which greets the caller with context already known — no re-intake.

### Webhook Endpoints

| Method | Path | Event | Description |
|--------|------|-------|-------------|
| POST | `/webhook?event=call-initiated` | `call-initiated` | Triggers `TriageRouter.onCall()` |
| POST | `/webhook?event=call-transfer-complete` | `call-transfer-complete` | Acknowledges transfer completion |
| POST | `/webhook?event=call-hangup` | `call-hangup` | Handles call termination |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Call not answered | `TELNYX_API_KEY` not set or invalid | Verify the secret is set: `telnyx-edge secrets add TELNYX_API_KEY "your_key"` |
| Double transfer occurs | Idempotency guard not working | Check that `done` flag is set to `1` after transfer; verify `route:<callId>` task ID is used |
| Sub-agent doesn't receive context | `client_state` not passed in transfer | Ensure `transferTo()` includes `client_state: btoa(JSON.stringify(payload))` |
| Return caller routed from scratch | Routing log empty or query failing | Verify `routing` table exists and `routeForReturn()` query matches schema |
| Actor not found on `idFromName` | Actor not deployed or binding mismatch | Check `telnyx.toml` `[[actors]]` binding matches `env.TRIAGE_ROUTER` |
| Misroute not recovered | `onMisroute()` not triggered | Ensure sub-agent calls back to the router's `onMisroute` endpoint |
| Worker restart drops call | Schedule not persisted | Verify `this.schedule()` uses `taskId` option for idempotency |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your application for Telnyx Edge Compute
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Open-source AI tooling and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for AI agents

## Related Examples

- [Voice IVR with Agent Backend (DEV-823)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-ivr-agent-backend) — A per-call natural-language IVR menu that transfers or handles once. This sample is distinct: it uses a **durable routing actor** that persists across callers and days, routes to **sub-agents**, recovers from misroutes, and routes return-callers by history.
- [Stateful Actor Todo (DEV-824)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/stateful-actor-todo) — Basic Agent SDK + SQL StateStore pattern
- [Multi-Agent Support Escalation (DEV-825)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/multi-agent-support-escalation) — Per-call multi-agent handoff without durable routing history

## Resources

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Core concepts, API reference, and best practices
- [Telnyx Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — Durable actor lifecycle, storage, and scheduling
- [Telnyx Voice — gather-using-ai](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai) — Speech capture and STT integration
- [Telnyx Voice API Reference](https://developers.telnyx.com/docs/voice/api) — Full Call Control API reference
- [Telnyx AI — OpenAI Integration](https://developers.telnyx.com/docs/ai/openai) — Zero-credential AI inference via the TELNYX binding
- [Telnyx Pricing](https://telnyx.com/pricing) — Voice, Edge Compute, and AI pricing details
- [Telnyx Product Page — Voice](https://telnyx.com/voice) — Programmable voice with global infrastructure
- [Telnyx Product Page — Edge Compute](https://telnyx.com/edge-compute) — Stateful actors at the edge
