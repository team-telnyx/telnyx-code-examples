```markdown
---
name: after-hours-answering
title: "After-Hours Answering Line"
description: "A durable Telnyx Edge actor that answers after-hours clinic calls, captures needs via AI, sends SMS confirmations, and schedules next-business-morning callbacks with cross-night caller recognition."
language: typescript
framework: edge
telnyx_products: [Voice, Messaging, AI, Agent SDK, Edge Compute]
---

# After-Hours Answering Line

A durable Telnyx Edge actor that answers after-hours clinic calls, captures the caller's need via AI, sends an immediate SMS confirmation, and schedules a next-business-morning callback — remembering every caller across nights so returning patients are recognized, not re-intaken.

## The Story

When Riverbend Family Health closes for the night, patients still get sick. A parent with a child running a fever at 10 PM, a senior with worsening chest pain on a Saturday — these calls can't go to a generic voicemail. If the after-hours system fails to capture urgency correctly, a high-acuity case gets buried behind a routine refill request, and patient safety slips. The clinic needs a presence that answers live, triages intelligently, and never forgets who called.

The actor IS the clinic's after-hours answering line. Born the moment the first after-hours call hits the clinic's E.164 number, it greets the caller by name, uses AI speech-to-text to capture their need, classifies urgency, and logs everything to durable SQL. It sends an SMS with the next available slot and arms a self-scheduled callback for 9 AM the next business morning. When the callback fires, it dials the queued callers back in urgency order, announcing each by name and reason. If a patient called Saturday about a rash and calls again Monday, the actor recognizes them instantly — no re-intake, no wasted time. The actor survives eviction, reboots, and platform restarts: the SQL log, the message history, and the armed schedule all persist, so a callback scheduled at 8 PM on Friday still fires at 9 AM Monday even if the Edge worker is killed and restarted between. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the programmable voice, messaging, and AI primitives that let a single Edge actor own an entire after-hours workflow across channels and across time. Unlike per-call functions that lose state when the call ends, Telnyx Edge actors are durable entities with built-in SQL storage, task scheduling, and zero-credential API bindings. The `TELNYX` binding injects authenticated access to Call Control, Messaging, and OpenAI-compatible AI inference directly into the actor's environment — no API key management, no external queues, no Redis. Voice answers the call, AI extracts the need, SMS confirms the slot, and `schedule()` wakes the actor at 9 AM to dial back — all within one durable entity that remembers every caller.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `POST /v2/calls` (Call Control) | Voice | Outbound callback dial to the queued caller |
| `POST /v2/calls/{call_control_id}/gather-using-ai` | Voice | AI speech-to-text capture of the caller's after-hours need |
| `POST /v2/calls/{call_control_id}/speak` | Voice | TTS greeting and callback announcement |
| `POST /v2/messages` | Messaging | SMS confirmation with next available slot + options |
| `POST /v2/ai/chat/completions` | AI | LLM extraction of reason + urgency from captured speech |
| `GET /v2/events` (webhooks) | Voice / Messaging | `call-initiated`, `inbound-message`, `call-hangup` callbacks |

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │         Telnyx Edge Runtime                 │
                    │                                             │
                    │  ┌──────────────────────────────┐          │
                    │  │   AfterHoursLine (Agent)     │          │
                    │  │   Durable per clinic line    │          │
                    │  │                              │          │
                    │  │  ┌──────────────────────┐   │          │
                    │  │  │  onCall(call)        │   │          │
                    │  │  │  1. Check SQL log    │   │          │
                    │  │  │  2. captureNeed()    │   │          │
                    │  │  │     → STT (gather)   │   │          │
                    │  │  │     → LLM (extract)  │   │          │
                    │  │  │  3. INSERT afterhours│   │          │
                    │  │  │  4. SMS confirmation │   │          │
                    │  │  └────────┬─────────────┘   │          │
                    │  │           │                 │          │
                    │  │  ┌────────┴─────────────┐   │          │
                    │  │  │  onSmsReply(text)    │   │          │
                    │  │  │  "1" → schedule()    │   │          │
                    │  │  │  next biz morning    │   │          │
                    │  │  └────────┬─────────────┘   │          │
                    │  │           │                 │          │
                    │  │  ┌────────┴─────────────┐   │          │
                    │  │  │  callback()          │   │          │
                    │  │  │  SELECT queued rows  │   │          │
                    │  │  │  dialBack() each     │   │          │
                    │  │  │  UPDATE calledBack   │   │          │
                    │  │  └──────────────────────┘   │          │
                    │  │                             │          │
                    │  │  ┌──────────────────────┐   │          │
                    │  │  │  recognizeCaller()   │   │          │
                    │  │  │  SELECT prior rows   │   │          │
                    │  │  │  → resume context    │   │          │
                    │  │  └──────────────────────┘   │          │
                    │  └──────────────────────────────┘          │
                    │           │  │  │  │                       │
                    │           ▼  ▼  ▼  ▼                       │
                    │  ┌──────────────────────┐  ┌────────────┐ │
                    │  │  AFTERHOURS_DB       │  │  TELNYX    │ │
                    │  │  (SQL Storage)       │  │  Binding   │ │
                    │  │  afterhours table    │  │  messages  │ │
                    │  │  caller log +        │  │  ai.openai │ │
                    │  │  message history     │  │  calls     │ │
                    │  └──────────────────────┘  └────────────┘ │
                    └─────────────────────────────────────────────┘
                              │        │        │
                    ┌─────────┼────────┼────────┼─────────┐
                    │         │        │        │         │
              call-initiated  │  inbound-message  │  call-hangup
                    webhook   │     webhook       │   webhook
                              ▼
                    ┌──────────────────────────────┐
                    │  Patient calls clinic line   │
                    │  → webhook → actor.onCall()  │
                    └──────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/after-hours-answering

# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# Generate type bindings
npm run types

# Run smoke test
npx tsx smoke_test.ts

# Deploy
npm run deploy
```

## API Reference

### Webhooks

#### `POST /webhook/call-initiated`

Triggered when an inbound call arrives at the clinic's Telnyx number.

**Request body:**
```json
{
  "data": {
    "payload": {
      "call": {
        "from": "+15551234567",
        "to": "+1555XXXXXXXX",
        "call_control_id": "abc123"
      }
    }
  }
}
```

**Response:** `200 OK` — `{ "received": true }`

#### `POST /webhook/inbound-message`

Triggered when the caller replies to the SMS confirmation.

**Request body:**
```json
{
  "data": {
    "payload": {
      "from": "+15551234567",
      "to": "+1555XXXXXXXX",
      "text": "1"
    }
  }
}
```

**Response:** `200 OK` — `{ "received": true }`

### Actor Methods

#### `onCall(call)`

Handles an inbound after-hours call. Checks for duplicate entries, captures the caller's need via AI, logs to SQL, and sends an SMS confirmation.

#### `onSmsReply(text, caller)`

Processes SMS replies. `"1"` arms the next-business-morning callback via `schedule()`. `"2"` sends a portal link.

#### `callback()`

Scheduled task that fires at 9 AM on the next business day. Queries all un-called-back entries ordered by urgency, dials each back, and marks them as called back.

#### `recognizeCaller(caller)`

Returns prior `afterhours` records for a given caller number, enabling cross-night recognition without re-intake.

### Health Check

#### `GET /health`

Returns `{"status": "ok"}` with HTTP 200.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Actor not responding to calls | Webhook URL not configured in Telnyx Mission Control | Set the `call-initiated` webhook URL in the Telnyx portal to `https://<your-edge-url>/webhook/call-initiated` |
| SMS not received | `TELNYX_API_KEY` not set or invalid | Verify the secret is set via `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| Callback not firing | Schedule was cancelled or worker evicted before re-arm | The actor re-arms the schedule on restart; check `lastCallbackAt` in actor state |
| Duplicate caller log entries | Redelivered `call-initiated` webhook | The `onCall` method checks for today's existing entry before inserting |
| Weekend callback skipped | `msUntilNextBizMorning()` skips Sat/Sun | Callback is scheduled for Monday 9 AM automatically |
| Demo mode still sending SMS | `DEMO_MODE` env var not set | Set `DEMO_MODE=true` in `.env` to use dry-run logging |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Appointment Reminders](https://github.com/team-telnyx/telnyx-code-examples/tree/main/appointment-reminders) — scheduled SMS reminders for confirmed appointments
- [Call Forwarding](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-forwarding) — route inbound calls based on business hours
- [Two-Way SMS Support](https://github.com/team-telnyx/telnyx-code-examples/tree/main/two-way-sms-support) — AI-powered SMS conversation agent

## Resources

- [Telnyx Agent SDK Docs](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors on Edge Compute](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Gather Using AI (STT)](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Dial API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Send Message API](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Inbound Message Callback](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Voice Product](https://telnyx.com/voice)
- [Telnyx Messaging Product](https://telnyx.com/messaging)
- [Telnyx AI Product](https://telnyx.com/ai)
```
