---
name: text-back-front-desk
title: "Text-Back Front Desk — Durable Two-Way SMS Booking Actor"
description: "A Telnyx Edge Agent that acts as a patient's booking thread: understands SMS intent via LLM, checks SQL availability, books slots, sends 24h/1h reminders, and survives restarts."
language: typescript
framework: edge
telnyx_products: [Messaging, Agent SDK, Inference, SQL, Scheduled Tasks]
---

# Text-Back Front Desk — Durable Two-Way SMS Booking Actor

A Telnyx Edge Agent that acts as a patient's booking thread: understands SMS intent via LLM, checks SQL availability, books slots, sends 24h/1h reminders, and survives restarts.

## The Story

A medical clinic's front-desk phone rings unanswered during lunch rush — patients leave voicemails that get lost, appointments slip through the cracks, and revenue walks out the door. What the clinic needs is a front-desk entity that never sleeps, never drops a thread, and remembers every patient's conversation across days. The actor IS the booking thread. Born the moment a patient texts "I'd like a cleaning next week," it runs an LLM intent step, queries its SQL availability calendar, proposes a slot, and books it when the patient replies "Thu 2pm works." It then arms two reminders — one 24 hours out, one 1 hour out — and if the patient texts "can I move it to Friday?" days later, the same actor re-wakes with the full thread history, moves the booking, and re-arms the reminders. The load-bearing moment is the interruption demo: kill the Edge function between the book and the first reminder, and the stable `remind:<thread>:d1` task re-arms on re-activation and fires on time — the booking in SQL is intact, no double reminder, no lost patient. Durability is the point, not the API calls. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a platform where durable actors, two-way SMS, LLM inference, and SQL state converge into a single runtime. Unlike stateless webhook handlers that forget everything between requests, Telnyx Edge Actors persist conversation history, booking state, and scheduled tasks across pod restarts and platform reboots. The `TELNYX` binding injects zero-credential access to both the Messaging API and OpenAI-compatible inference, while the built-in SQL database and `schedule()` primitive give the actor a durable home for appointments and reminders. This is infrastructure designed for multi-day, multi-turn customer journeys — not one-shot auto-replies.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /webhook/inbound-message` | Receives customer SMS texts; spawns or wakes the `FrontDesk` actor per customer E.164 |
| `POST /webhook/delivery-update` | Receives delivery confirmations and failures; triggers retry-once for undeliverable reminders |
| `TELNYX.messages.send()` | Sends outbound SMS: slot offers, booking confirmations, reminders, reschedule confirmations |
| `TELNYX.ai.openai.chat.createCompletion()` | LLM intent extraction: book / reschedule / cancel + service + time window |
| `APPOINTMENTS_DB.prepare()` | SQL queries against the availability calendar and appointments table |
| `Agent.schedule()` | Schedules 24h (`remind:<thread>:d1`) and 1h (`remind:<thread>:h1`) reminder tasks |
| `Agent.idFromName()` | Self-provisions one durable actor per customer phone number |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Runtime                              │
│                                                                         │
│  ┌──────────────────┐     ┌──────────────────┐                          │
│  │  Webhook Entry   │     │  Default Export  │                          │
│  │  src/index.ts    │     │  (fetch handler) │                          │
│  │                  │     │                  │                          │
│  │  /webhook/       │     │  Routes inbound  │                          │
│  │  inbound-message │────▶│  messages to     │                          │
│  │  /delivery-update│     │  actor stubs     │                          │
│  └──────────────────┘     └────────┬─────────┘                          │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  FrontDesk Actor (extends Agent)                                 │   │
│  │  ──────────────────────────────────────────────────────────────  │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │  onMessage() │  │  intent()    │  │  book()      │            │   │
│  │  │  (text)      │──│  (LLM via    │──│  (SQL INSERT)│            │   │
│  │  │              │  │  TELNYX.ai)  │  │              │            │   │
│  │  └──────────────┘  └──────────────┘  └──────┬───────┘            │   │
│  │                                             │                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────▼───────┐            │   │
│  │  │  findSlots() │  │  moveBooking()│  │  remind()    │            │   │
│  │  │  (SQL SELECT)│  │  (SQL UPDATE) │  │  (idempotent)│            │   │
│  │  └──────────────┘  └──────────────┘  └──────┬───────┘            │   │
│  │                                             │                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────▼───────┐            │   │
│  │  │  cancel()    │  │  sendSms()   │  │  schedule()  │            │   │
│  │  │  (SQL UPDATE)│  │  (TELNYX)    │  │  (24h/1h)    │            │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘            │   │
│  │                                                                  │   │
│  │  State: { thread, status, bookedSlot, service,                    │   │
│  │           reminded: { d1, h1 }, history[] }                       │   │
│  │  Storage: APPOINTMENTS_DB (SQL)                                    │   │
│  │  Tasks: remind:<thread>:d1, remind:<thread>:h1                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  TELNYX Binding (zero-credential)                                  │   │
│  │  • messages.send({ to, from, text })                               │   │
│  │  • ai.openai.chat.createCompletion({ model, messages })            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  APPOINTMENTS_DB (SQL)                                             │   │
│  │  • appointments(thread, slot, service, ts, status)                 │   │
│  │  • availability(service, slot)                                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

Data Flow:
  Customer SMS → inbound-message webhook → FrontDesk actor (idFromName: E.164)
    → LLM intent → SQL availability check → SMS slot offer
    → Customer confirms → SQL INSERT appointment → schedule() 24h + 1h reminders
    → Reminder fires → SMS → idempotent guard (reminded flag)
    → Customer reschedules → SQL UPDATE → re-arm reminders
    → Delivery fails → delivery-update webhook → retry-once via actor
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-back-front-desk

# 2. Create .env from the example
cp .env.example .env
# Edit .env and add your TELNYX_API_KEY

# 3. Install dependencies
npm install

# 4. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# 5. Generate typed environment bindings
telnyx-edge types

# 6. Run the smoke test
npx tsx smoke_test.ts

# 7. Deploy to Telnyx Edge
telnyx-edge ship
```

## API Reference

### Webhook Endpoints

#### `POST /webhook/inbound-message`

Receives inbound SMS from Telnyx. Spawns or wakes a `FrontDesk` actor per customer phone number.

**Request Body** (Telnyx webhook payload):
```json
{
  "data": {
    "payload": {
      "from": { "phone_number": "+15551234567" },
      "to": [{ "phone_number": "+15559999999" }],
      "message": { "text": "I'd like a cleaning next week" }
    }
  }
}
```

**Response**: `200 OK` — message forwarded to the actor.

#### `POST /webhook/delivery-update`

Receives delivery status updates. Triggers retry-once for undeliverable messages.

**Request Body**:
```json
{
  "data": {
    "payload": {
      "message_id": "msg-123",
      "status": "undelivered",
      "to": [{ "phone_number": "+15551234567" }]
    }
  }
}
```

### Actor Methods

#### `onMessage(text, from, to)`

Main entry point for customer SMS. Runs LLM intent extraction, then dispatches to `book`, `reschedule`, or `cancel` flows.

#### `intent(text)`

Calls `TELNYX.ai.openai.chat.createCompletion()` with a system prompt to extract `{ action, service, window }` from the customer's text.

#### `findSlots(service, window)`

Queries `APPOINTMENTS_DB` for available slots in the given service and time window, excluding already-booked slots.

#### `book(slot, service, thread)`

Inserts an appointment into SQL, updates actor state, and schedules two reminder tasks:
- `remind:<thread>:d1` — 24 hours before the slot
- `remind:<thread>:h1` — 1 hour before the slot

#### `remind({ kind })`

Sends a reminder SMS. Guarded by `state.reminded[kind]` to ensure exactly-once delivery.

#### `moveBooking(window, from)`

Updates the SQL appointment to a new slot, resets the `reminded` flags, and re-arms both reminder tasks.

#### `cancelBooking(from)`

Marks the SQL appointment as `cancelled` and sends a confirmation SMS.

#### `sendSms(to, text)`

Sends an SMS via `TELNYX.messages.send()`. In demo mode (`DEMO_MODE=true`), logs to console instead.

### Scheduled Tasks

| Task ID | Delay | Handler | Description |
|---------|-------|---------|-------------|
| `remind:<thread>:d1` | 24h before slot | `remind({ kind: "d1" })` | Day-before reminder with reschedule/cancel options |
| `remind:<thread>:h1` | 1h before slot | `remind({ kind: "h1" })` | Hour-before reminder |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Actor not waking on SMS | Webhook URL not registered in Telnyx Portal | Register `https://<your-deployment>.telnyx.dev/webhook/inbound-message` in the Telnyx Messaging Profile |
| Reminders not firing | `schedule()` delay is negative (slot already passed) | `parseSlotToMs()` clamps to `now + 86400_000` as fallback; verify slot parsing logic |
| Double reminder sent | `reminded` guard not persisted | Ensure `setState()` is called after setting `reminded[kind] = true` |
| Delivery-update retry loop | Retry logic re-sends to same failed number | Retry-once is handled by the actor's `retrySms()` method; verify `delivery-update` webhook is configured |
| LLM returns invalid JSON | Model hallucinates non-JSON output | Fallback returns `{ action: "book", service: "cleaning", window: "next week" }` |
| SQL table not found | Database not initialized | Run `telnyx-edge types` and ensure `APPOINTMENTS_DB` binding is configured in `telnyx.toml` |
| Demo mode still sending SMS | `DEMO_MODE` flag overridden | Check `.env` — `DEMO_MODE` defaults to `true`; set to `false` only for live testing |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-1141 — Email Schedule Rescheduler**: Same booking/reschedule flow but over email instead of SMS. Distinct channel, distinct actor ownership of the two-way thread.
- **One-Way SMS Notify**: Sends appointment reminders without two-way conversation or booking capability.
- **Voice Call Control**: Uses Call Control API for appointment reminders via phone calls instead of SMS.

## Resources

- [Telnyx Messaging — Send Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx API Reference — Inbound Message Callback](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK — Message History](https://developers.telnyx.com/docs/agent-sdk/message-history)
- [Agent SDK — SQL](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK — Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Agent SDK — Calling LLMs](https://developers.telnyx.com/docs/agent-sdk/concepts/calling-llms)
- [Telnyx Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Pricing](https://telnyx.com/pricing)
