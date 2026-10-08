# Clinic Triage, Handoff & Escalation (DEV-1187)

One Telnyx Edge function routes every inbound phone line to its own AI assistant persona, keeps a durable per-caller routing log, and escalates medical emergencies to a human on-call nurse — with an SMS alert, a spoken briefing, and a live bridge into the call.

## What it does

```
Caller dials the clinic line
        │
        ▼
Edge function answers → routes to the front-desk assistant
  (injects the caller's routing history as a dynamic variable)
        │
        ├─ INFORMATIONAL (hours, address) ──────→ answered, done
        │
        ├─ BILLING / CLINICAL (routine)
        │      → the assistant logs the intent (webhook tool)
        │      → native warm transfer to the right desk
        │        (AI-to-AI consult → acceptance → bridge)
        │      → the desk assistant greets the caller WITH the context
        │
        ├─ 🚨 URGENT (chest pain, breathing trouble, …)
        │      → the assistant flags the emergency (escalate tool)
        │      → Edge function: SMS to the on-call nurse (caller + what was said)
        │      → Edge function: dials the nurse's phone live
        │      → when the nurse answers: the AI briefs her, then bridges
        │        the patient onto her call — the human takes over
        │
        └─ AFTER HOURS (non-urgent) ───────────→ message taken, callback scheduled
```

Every call is written to the router's durable SQL log: who called, what they needed, and what happened (`CALLSTART` → `billing`/`clinical` → `escalated`/`transferred`). The next call from the same number is greeted with that history — "welcome back, I see you called about billing."

## Architecture

- **One Edge function** (`src/index.ts`) — the router. It owns call identity (records the caller at `call.initiated`), routes each phone line to its assistant persona, exposes the log + escalation endpoints, and renders the care-team view.
- **Three AI assistants** (created via the Telnyx Assistants API — see *Assistant setup* below): the front desk, the billing desk, the clinical desk. Each has its own phone number.
- **One durable actor** (`TriageRouterV3`) — per-deployment SQL storage for the routing log. Survives restarts and redeploys.
- **Warm transfers** use the Assistants-native `transfer` tool with `warm_transfer_acceptance` enabled: the destination desk must accept (an AI-to-AI consult the caller hears as ringback) before the caller is bridged.
- **Escalations** are code paths, not model behavior: the assistant's `escalate_urgent` tool hits the Edge function, which fetches the conversation transcript, sends the SMS, dials the nurse, speaks the briefing, and bridges — deterministically.

## Assistant setup (required)

Create three assistants via the API or Mission Control, then list their IDs per phone line in `ASSISTANT_ROUTES_JSON`.

| Assistant | Model | Tools |
|---|---|---|
| Front desk | `anthropic/claude-haiku-4-5` | `transfer` (warm acceptance, targets = the desk numbers) + three `log_*` webhook tools + `escalate_urgent` |
| Billing desk | `anthropic/claude-haiku-4-5` | `transfer` (warm acceptance, target = clinical desk) |
| Clinical desk | `moonshotai/Kimi-K2.6` | none |

The `log_*` tools are intent-specific (`log_billing`, `log_clinical`, `log_afterhours`) with the intent baked into each URL path — the model only picks which tool to call, it never fills arguments. The caller identity is attached by the Edge function, not the tool.

## Wiring

1. Point every phone line at one Call Control application; set its webhook to this function's `/webhooks/voice`.
2. Assign an **outbound voice profile** to that application (required for the assistant transfers and the nurse dial to dial out).
3. Attach a **messaging profile with a 10DLC-registered number** for the escalation SMS — carriers block unregistered A2P SMS silently (the API accepts, the carrier drops). Set that number in `SMS_FROM_NUMBER`.
4. Push the assistant IDs, the on-call nurse number, and the connection ID via `telnyx-edge secrets add` (see `.env.example`).

## Files

| File | What it is |
|---|---|
| `src/index.ts` | The Edge function — routing, identity, escalation, care-team UI |
| `telnyx.toml` | Actor + secrets + telnyx bindings (env vars do not propagate on Edge deploys — use secrets) |
| `.env.example` | Every deploy-time value |
| `API.md` | The HTTP surface |
| `smoke_test.ts` | Unit tests for the router lifecycle and classification |

Ticket: [DEV-1187](https://linear.app/telnyx/issue/DEV-1187/sprint-17-clinic-triage-and-handoff)

## Why Telnyx

This sample shows what makes Telnyx different from bolt-on voice AI: one phone number on one Edge deployment runs three durable assistant personas, the routing brain is an actor with its own SQL (state survives restarts and redeploys), and the escalation path — SMS, live nurse dial, spoken briefing, bridge — is plain Call Control code, not vendor glue. Speech capture, text-to-speech (Telnyx Ultra voices), inference, messaging, and compute are all on one platform, one API key, one bill.

## AI Communications Infrastructure

The clinic runs on Telnyx's AI Communications Infrastructure: programmable voice with Call Control, durable AI agents on Edge Compute, native inference for intent classification and briefing summaries, and messaging for the on-call escalation — the same network that carries the calls carries the handoffs.

## Troubleshooting

- **Call rings forever** — the phone number's Call Control app must point at this function's `/webhooks/voice` and the function must be `deploy_ok` (`telnyx-edge list`). Real calls produce webhook deliveries within a second; if you see none, check the app binding.
- **Silence after answer** — the assistant's TTS voice must be a valid Telnyx voice (`Telnyx_Katie`, `female`…). Invalid voice values are accepted by the API and fail at synthesis — check the function logs for `call.speak.failed`.
- **Assistant never speaks its greeting** — greeting interruption must be disabled (`interruption_settings.disable_greeting_interruption: true`), otherwise caller breath/noise cuts the greeting mid-sentence.
- **Escalation SMS never arrives** — the sending number must be 10DLC-registered. Unregistered senders are accepted by the API and silently dropped by carriers ("Not 10DLC registered" in the message status). Verify with `GET /v2/messages/{id}`.
- **Transfer 403 "D38"** — the Call Control application needs an outbound voice profile assigned (`PATCH /v2/call_control_applications/{id}` with `outbound.outbound_voice_profile_id`).
- **Actor method not found** — Edge actor-method registration is captured at first deploy; after changing an actor's method set, redeploy (or rename the actor type) so the registry refreshes.

## Related Examples

- [ai-assistants](../ai-assistants/) — assistant fundamentals: models, voices, tools
- [warm-transfer-ai-briefing-python](https://github.com/team-telnyx/telnyx-code-examples/tree/main/warm-transfer-ai-briefing-python) — the warm-transfer mechanics this sample builds routing on
- [appointment-recovery-waitlist](../appointment-recovery-waitlist/) — the callback scheduling companion for after-hours messages

## Agent Discovery

The three assistant personas are created via the [Telnyx Assistants API](https://developers.telnyx.com/api-reference/assistants/create-an-assistant) — see *Assistant setup* above for the model, voice, and tool configuration each one needs. `ASSISTANT_ROUTES_JSON` maps each phone line to its assistant ID, and the Edge function injects the routing history as a dynamic variable per call. Browse the assistants in [Mission Control](https://portal.telnyx.com/#/ai/assistants) and the conversations they produce under **Conversation History**.
