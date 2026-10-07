---
name: clinic-triage-handoff
title: "Clinic Triage & Warm Handoff — Per-Line AI Assistants with Routing Log"
description: "One Telnyx Edge function routes each clinic phone line to its own AI Assistant (receptionist + billing + clinical desks), executes a native warm transfer with DTMF acceptance, and remembers every caller in a durable routing actor."
language: typescript
framework: edge
telnyx_products: [Voice, AI Assistants, Edge Compute, Agent SDK]
---

# clinic-triage-handoff

One Telnyx Edge function routes each clinic phone line to its own AI Assistant persona (receptionist on the main line, billing desk, clinical desk), executes a native warm transfer with DTMF acceptance, and keeps a durable per-caller routing log so return callers are recognized the moment they ring in again. Ticket: **DEV-1187**.

## The Story

A midsize medical clinic — Riverbend Family Practice — runs three inbound phone lines: a main clinic line that anyone can ring, a billing desk for invoices, and a clinical desk for nurses. Today, three different human teams answer those lines. The verified deploy replaces every line with a Telnyx AI Assistant persona and wires them together with one Edge function that:

- Routes each inbound line to its own persona (receptionist, billing desk, clinical desk) on the `call.initiated` webhook.
- Lets the receptionist use the native Telnyx AI Assistant `transfer` tool — the caller speaks freely, the assistant dials the right desk, the desk hears a brief briefing, and the desk presses **1** to accept (warm-transfer acceptance) before the conference bridge opens.
- Keeps a single durable `TriageRouterV3` actor that owns the per-caller routing log. The last routing decision for any phone number is injected as a `dynamic_variables` field on the next inbound call, so a return caller is greeted with the right context the instant they ring in.
- Exposes a `flag_misroute` webhook tool the specialist desks fire when a caller is on the wrong line. The webhook warms the caller's existing call leg to the right desk and stashes the misroute summary in a pending table; when the caller hits the receiving desk's `call.initiated`, the summary is injected as `dynamic_variables.misroute_context`.

When the Edge worker restarts mid-call, the actor's SQL storage survives, the `route:<callId>` row is intact, and the warm-transfer ring still completes exactly once.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** where AI assistants, voice call control, and durable edge compute converge in one platform. This sample stitches three primitives together that no other provider offers in a single worker: native AI assistants with `transfer` tools and `dynamic_variables`, native warm-transfer accept via DTMF (`gather_using_speak`), and a single durable actor (`TriageRouterV3`) whose SQL storage survives restarts and persists the per-caller routing history used to greet return callers. Everything below — assistant IDs, line-to-desk map, misroute targets, webhook URL — is configurable via Edge secrets so the same source deploys to any clinic.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `POST /v2/calls/{id}/actions/answer` | Voice | Answer with the line's AI Assistant + dynamic variables |
| `POST /v2/calls/{id}/actions/gather_using_ai` | Voice | Capture caller intent in one turn (receptionist) |
| `POST /v2/calls/{id}/actions/gather_using_speak` | Voice | Deliver warm-transfer briefing + DTMF accept/decline (specialist) |
| `POST /v2/calls/{id}/actions/speak` | Voice | Hold message + decline fallback |
| `POST /v2/calls/{id}/actions/transfer` | Voice | Misroute warm-transfer to the correct desk |
| `POST /v2/calls/{id}/actions/join` | Voice | Bridge caller leg and specialist leg into a conference |
| `POST /v2/calls/{id}/actions/hangup` | Voice | End the specialist leg when it declines |
| `POST /v2/calls` | Voice | Dial the caller's own phone as the specialist desk |
| `telnyx.ai.openai.chat.createCompletion` (TELNYX binding) | AI | Intent classification + one-line summary |
| `ctx.storage.sql` (Agent SDK) | Edge Compute | Routing log, return-caller history, pending misroute queue |
| `Agent<TriageRouterV3>` (Agent SDK) | Edge Compute | Durable per-line routing brain |
| `POST /flag_misroute` webhook tool | AI Assistants | Specialist desk re-routes a caller mid-call |

## Architecture

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                  Telnyx Edge Runtime                    │
                    │                                                          │
   Caller ─────────►│  POST /webhooks/voice   event=call.initiated             │
                    │         │                                                │
                    │         ▼                                                │
                    │  ┌─────────────────────┐                                 │
                    │  │   TriageRouterV3    │  ◄── idFromName(lineE164)        │
                    │  │   (durable actor)   │                                 │
                    │  │                     │                                 │
                    │  │  1. ASSISTANT_ROUTES│  → receptionist / billing /      │
                    │  │     [line]          │    clinical desk persona        │
                    │  │  2. lastIntentFor() │──► SQL routing log              │
                    │  │     → dynamic_variables.routing_history               │
                    │  │  3. pendingMisrouteFor()                              │
                    │  │     → dynamic_variables.misroute_context              │
                    │  │  4. answer({ assistant: { id, dynamic_variables }})   │
                    │  └─────────┬───────────┘                                 │
                    │            │                                             │
                    │            ▼                                             │
                    │  ┌─────────────────────┐                                 │
                    │  │   AI Assistant      │  (receptionist / billing /      │
                    │  │   per phone line    │   clinical desk persona)        │
                    │  │                     │                                 │
                    │  │  - receptionist:    │                                 │
                    │  │      gather_using_ai│  → utterance                    │
                    │  │      transfer tool  │  → call.ai_gather.ended         │
                    │  │  - specialist desk: │                                 │
                    │  │      flag_misroute  │  → POST /misroute               │
                    │  └─────────┬───────────┘                                 │
                    │            │                                             │
                    │            ▼                                             │
                    │  call.ai_gather.ended → classify + summarize             │
                    │      → INSERT routing (intent, transcript, stage)        │
                    │      → speak("hold") → POST /v2/calls (warm-dial leg)   │
                    │                                                          │
                    │  Specialist leg call.answered:                           │
                    │      gather_using_speak(briefing, "Press 1 to accept")   │
                    │                                                          │
                    │  call.gather.ended:                                      │
                    │      digits=1 → join conference on both legs             │
                    │      digits=2 → hangup specialist, speak fallback        │
                    │                                                          │
                    │  Specialist desk → flag_misroute tool:                   │
                    │      POST /misroute  → SQL pending + transfer(leg)       │
                    └──────────────────────────────────────────────────────────┘
```

**Data flow:**

1. **Inbound call** → `call.initiated` → handler reads `ASSISTANT_ROUTES[line]` and answers with the line's AI Assistant.
2. **Per-caller context** → before answering, the handler calls `router.lastIntentFor(fromNumber)` and `router.pendingMisrouteFor(fromNumber)`. Any results are passed as `assistant.dynamic_variables`, so the receptionist greets the caller with `routing_history` / `misroute_context` already in context.
3. **Receptionist capture** → `gather_using_ai` captures one utterance; the assistant fires its native `transfer` tool.
4. **Classification + routing log** → `call.ai_gather.ended` → `classifyIntent()` (LLM with keyword fallback) → `INSERT routing` → `summarize()` for the specialist briefing.
5. **Warm dial** → `POST /v2/calls` dials the specialist's real phone as a new leg with `client_state = { role: "next_agent", transferId, callerCcid, intent, briefing }`.
6. **Specialist accept** → on `call.gather.ended` for the specialist leg, `1` joins both legs into a named conference; `2` hangs up the specialist leg and speaks a fallback.
7. **Misroute recovery** → the specialist desk's `flag_misroute` tool calls `POST /misroute`. The webhook stashes the misroute summary in `misroute_pending` keyed by the desk's line, then transfers the caller's existing leg to the correct desk (read from `MISROUTE_TARGETS`). On the next `call.initiated` for that caller, the summary is injected as `misroute_context`.
8. **Status page** → `GET /` renders the live routing table from the actor's `routing` rows.

## Environment Variables

On Telnyx Edge, every value below is set with `telnyx-edge secrets add <NAME> <value>`. The function fails fast when a required constant is missing instead of silently using someone else's phone numbers or assistant IDs.

| Variable | Type | Required | Description |
|---|---|---|---|
| `TELNYX_API_KEY` | string | yes | Telnyx REST API key (used by the warm-dial + transfer calls). |
| `CONNECTION_ID` | string | yes | Telnyx Call Control application ID used to originate the warm-dial leg. |
| `WEBHOOK_URL` | string | yes | Public URL for the function's `/webhooks/voice` endpoint. |
| `AI_MODEL` | string | no | OpenAI-compatible model used for classification + summary (default `gpt-4o-mini`). |
| `CLINIC_VOICE` | string | no | Voice used by the receptionist (default `Telnyx_Katie`). |
| `SPECIALIST_VOICE` | string | no | Voice used by the specialist desk briefings (default `Telnyx_FLORA`). |
| `STATUS_PAGE_LINE` | string | no | E.164 line used to seed the status page router (defaults to `clinic-triage-status`). |
| `ASSISTANT_ROUTES_JSON` | JSON string | yes | Map of inbound line (E.164) → Telnyx AI Assistant ID. Three keys: clinic line (receptionist), billing desk, clinical desk. |
| `MISROUTE_TARGETS_JSON` | JSON string | yes | Map of desk line (E.164) → desk line (E.164) to dial on `flag_misroute`. |

See [`.env.example`](./.env.example) for the local-development equivalent and shape examples for the two JSON maps.

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clinic-triage-handoff

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Telnyx API key, connection ID, webhook URL,
# ASSISTANT_ROUTES_JSON, and MISROUTE_TARGETS_JSON.

# Generate type bindings from telnyx.toml
npx telnyx-edge types

# Run smoke test
npx tsx smoke_test.ts

# Push per-deploy secrets to Edge (see .env.example for the full list)
telnyx-edge secrets add TELNYX_API_KEY          "<your-key>"
telnyx-edge secrets add CONNECTION_ID           "<call-control-app-id>"
telnyx-edge secrets add WEBHOOK_URL             "https://<func>.telnyxcompute.com/webhooks/voice"
telnyx-edge secrets add STATUS_PAGE_LINE        "+15550000001"
telnyx-edge secrets add ASSISTANT_ROUTES_JSON   '{"+15550000001":"assistant-<receptionist>","+15550000002":"assistant-<billing>","+15550000003":"assistant-<clinical>"}'
telnyx-edge secrets add MISROUTE_TARGETS_JSON   '{"+15550000002":"+15550000003","+15550000003":"+15550000002"}'

# Deploy to Telnyx Edge
npx telnyx-edge ship
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Create three Telnyx AI Assistants (one per line) and capture their IDs
telnyx ai assistants create --name "Clinic Receptionist"   --voice "Telnyx_Katie"
telnyx ai assistants create --name "Clinic Billing Desk"   --voice "Telnyx_FLORA"
telnyx ai assistants create --name "Clinic Clinical Desk"  --voice "Telnyx_FLORA"

# Buy / assign three phone numbers, one per line, and bind them to a Call Control application
telnyx number-orders create --phone-numbers.count 3
telnyx call-control-applications create --name "Clinic Triage App"

# Provision the Edge function
telnyx edge functions init clinic-triage-handoff
```

</details>

## API Reference

### Inbound webhook (`/webhooks/voice`)

Receives every Telnyx Call Control event. The handler branches on `data.event_type`:

| Event | Behavior |
|---|---|
| `call.initiated` | Looks up the line in `ASSISTANT_ROUTES`, injects `routing_history` + `misroute_context` as dynamic variables, answers with that assistant. |
| `call.answered` | Caller leg: greets + `gather_using_ai`. Specialist leg (client_state `role=next_agent`): `gather_using_speak` briefing with DTMF accept/decline. |
| `call.ai_gather.ended` | Classifies the utterance, writes a `routing` row, speaks the hold message, dials the specialist leg with `client_state`. |
| `call.gather.ended` | Specialist DTMF: `1` joins both legs into a conference; `2` hangs up the specialist leg and speaks the fallback. |
| `call.hangup` | Acknowledges. |
| `call.speak.failed` | Logs and ignores. |

### `POST /log`

Insert a row into the actor's routing log. Useful when an assistant wants to record a downstream action against the caller's history (e.g., the billing desk confirming a payment plan).

**Body (JSON or query params):**

| Field | Type | Required | Description |
|---|---|---|---|
| `caller` | string | yes | Caller's E.164 phone number. |
| `intent` | string | yes | Short intent tag (`billing`, `clinical`, `afterhours`, or any custom label). |
| `note` | string | no | Free-form note. |

```bash
curl -X POST "https://<edge-endpoint>/log" \
  -H "Content-Type: application/json" \
  -d '{"caller":"+15550001234","intent":"billing","note":"payment plan confirmed"}'
```

### `POST /misroute`

Webhook target for the specialist desks' `flag_misroute` tool. Stashes the misroute summary against the desk's line and warm-transfers the caller's existing leg to the correct desk from `MISROUTE_TARGETS`. When the caller hits the receiving desk's `call.initiated`, the summary is injected as `misroute_context` on that assistant.

**Body (JSON or query params):**

| Field | Type | Required | Description |
|---|---|---|---|
| `desk_line` / `desk` | string | yes | The desk that flagged the misroute (E.164). |
| `caller` | string | yes | Caller's E.164 phone number. |
| `summary` | string | no | One-line reason the caller was misrouted. |
| `call_control_id` / `ccid` | string | yes (for transfer) | The caller leg's control ID. If present and `desk_line` is in `MISROUTE_TARGETS`, the leg is transferred. |

```bash
curl -X POST "https://<edge-endpoint>/misroute" \
  -H "Content-Type: application/json" \
  -d '{"desk_line":"+15550000002","caller":"+15550001234","summary":"billing issue, but needs nurse triage","call_control_id":"CA..."}'
```

### `GET /`

Renders a Telnyx-branded HTML status page with the 10 most recent `routing` rows from the actor.

### `GET /healthz`

```json
{ "ok": true, "service": "clinic-triage-handoff" }
```

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `CONNECTION_ID is not configured` | Edge secret missing | `telnyx-edge secrets add CONNECTION_ID "<id>"` then redeploy. |
| Calls answered but no persona | `ASSISTANT_ROUTES_JSON` empty / wrong shape | Validate JSON with `python -m json.tool`; re-add via `telnyx-edge secrets add`. |
| Warm-dial leg fails | `WEBHOOK_URL` unreachable from Telnyx | Make sure `<func>.telnyxcompute.com/webhooks/voice` returns 200 to a synthetic POST. |
| Misroute tool returns but caller stays on the wrong desk | `MISROUTE_TARGETS_JSON` missing the desk's line, or `call_control_id` not supplied | Add the mapping and confirm the assistant passes `ccid` from `dynamic_variables`. |
| Return caller greeted from scratch | Routing table empty for that `caller` | Normal on first call; check that `POST /log` is wired so the routing log captures the first decision. |
| Status page shows "No calls routed yet" | Actor seed missing | `telnyx-edge secrets add STATUS_PAGE_LINE "<clinic-line>"` and reload. |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your application for Telnyx Edge Compute
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Open-source AI tooling and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for AI agents

## Related Examples

- [Sub-Agent Orchestrator Actor (DEV-1085)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sub-agent-orchestrator-actor) — Multi-agent orchestration with KV-first resumability, distinct from this sample's per-line assistant personas.
- [AI-Powered Call Router](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-powered-call-router) — LLM-based intent routing for a single inbound line.
- [Auto-Failover Voice Routing](https://github.com/team-telnyx/telnyx-code-examples/tree/main/auto-failover-voice-routing) — Failover patterns for voice infrastructure.

## Resources

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Core concepts, API reference, and best practices
- [Telnyx Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — Durable actor lifecycle, storage, and scheduling
- [Telnyx Voice — gather-using-ai](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai) — Speech capture and STT integration
- [Telnyx Voice — Call Control Transfer](https://developers.telnyx.com/docs/voice/programmable-voice/call-control-transfer) — Programmable transfer semantics used by `flag_misroute`
- [Telnyx AI — Assistants API](https://developers.telnyx.com/docs/ai-assistants) — Native AI assistant personas with `transfer` tools and `dynamic_variables`
- [Telnyx Pricing](https://telnyx.com/pricing) — Voice, Edge Compute, and AI pricing details
- [Telnyx Product Page — Voice](https://telnyx.com/voice) — Programmable voice with global infrastructure
- [Telnyx Product Page — Edge Compute](https://telnyx.com/edge-compute) — Stateful actors at the edge
