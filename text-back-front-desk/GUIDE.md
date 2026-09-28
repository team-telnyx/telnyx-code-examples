# Text-Back Front Desk — Developer Guide

A step-by-step tutorial for the `text-back-front-desk` sample: a durable, two-way SMS booking actor that handles intent classification, availability lookup, slot booking, reminder scheduling, rescheduling, and delivery-retry — all surviving pod restarts and worker kills.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Project Structure](#project-structure)
5. [How It Works — Step by Step](#how-it-works--step-by-step)
   - [Step 1: Inbound SMS Triggers Actor Birth](#step-1-inbound-sms-triggers-actor-birth)
   - [Step 2: LLM Intent Classification](#step-2-llm-intent-classification)
   - [Step 3: Availability Lookup via SQL](#step-3-availability-lookup-via-sql)
   - [Step 4: Slot Offer via SMS](#step-4-slot-offer-via-sms)
   - [Step 5: Customer Confirms → Booking + Reminders](#step-5-customer-confirms--booking--reminders)
   - [Step 6: Rescheduling via Follow-Up Text](#step-6-rescheduling-via-follow-up-text)
   - [Step 7: 24h / 1h Reminder Ticks](#step-7-24h--1h-reminder-ticks)
   - [Step 8: Delivery Update Retry](#step-8-delivery-update-retry)
   - [Step 9: Restart Proofing](#step-9-restart-proofing)
6. [Demo Mode vs Live Mode](#demo-mode-vs-live-mode)
7. [Running the Sample](#running-the-sample)
8. [Smoke Test](#smoke-test)
9. [Next Steps](#next-steps)

---

## Overview

This sample implements a **durable front-desk booking agent** using the Telnyx Agent SDK. A customer texts a clinic's front-desk number with a request like *"I'd like a cleaning next week."* The `FrontDesk` actor:

1. Is **self-provisioned** on the first inbound SMS (one actor per customer E.164 number).
2. Uses **OpenAI via the TELNYX binding** to classify intent (book / reschedule / cancel).
3. Queries a **SQL availability calendar** for open slots.
4. Sends a **two-way SMS offer** via `send-a-message`.
5. On confirmation, **books the slot** in SQL and **schedules two reminders** (24h and 1h before).
6. On a reschedule text, **re-wakes with full thread history**, moves the booking, and **re-arms reminders**.
7. Handles **delivery-update** callbacks to retry undeliverable messages once.
8. Survives **worker kills and pod restarts** — the booking and reminder schedule are durable.

### Primitives Used

| Primitive | Telnyx SDK Feature |
|---|---|
| **Agent SDK** | `class FrontDesk extends Agent<Env, ThreadState>` — durable booking thread |
| **Messaging (inbound)** | `inbound-message` webhook → `onMessage()` |
| **Messaging (outbound)** | `this.env.TELNYX.messages.send()` |
| **Inference** | `this.env.TELNYX.ai.openai.chat.createCompletion()` |
| **StateStore / SQL** | `this.env.APPOINTMENTS_DB.prepare(...)` — appointments + availability |
| **Scheduled Tasks** | `this.schedule(delay, "remind", { kind }, { id })` — 24h/1h reminders |
| **Delivery Updates** | `delivery-update` webhook → retry-once logic |

---

## Prerequisites

- Node.js 18+ (for `telnyx-edge` CLI and `tsx` smoke test runner)
- A Telnyx account with:
  - A [messaging profile](https://developers.telnyx.com/docs/messaging) and phone number
  - API key with `message_send` and `ai` permissions
- `telnyx-edge` CLI installed and authenticated:
  ```bash
  npm install -g @telnyx/edge-cli
  telnyx-edge auth api-key set <your_api_key>
  ```

---

## Environment Setup

### 1. Clone and install

```bash
cd text-back-front-desk
npm install
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` file declares all bindings:

```toml
name = "text-back-front-desk"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "FRONT_DESK"
type    = "FrontDesk"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.APPOINTMENTS_DB]
id = "<sqldb-namespace-uuid>"

[env_vars]
FRONT_DESK_NUMBER = "+1555XXXXXXXX"
```

- **`FRONT_DESK`** — the durable actor namespace. Each customer's E.164 number maps to a unique actor ID via `idFromName()`.
- **`TELNYX`** — zero-credential Telnyx API binding (SMS + AI).
- **`APPOINTMENTS_DB`** — SQL database for `appointments` and `availability` tables.
- **`TELNYX_API_KEY`** — stored as a secret, never in code.
- **`FRONT_DESK_NUMBER`** — the clinic's Telnyx phone number (env var, not secret).

### 3. Set secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
```

### 4. Generate type definitions

```bash
npm run types
```

This regenerates `telnyx-env.d.ts` from your `telnyx.toml` bindings.

### 5. Seed the availability calendar

The SQL database needs an `availability` table and an `appointments` table. Run this once:

```sql
CREATE TABLE IF NOT EXISTS availability (
  service TEXT,
  slot TEXT,
  PRIMARY KEY (service, slot)
);

CREATE TABLE IF NOT EXISTS appointments (
  thread TEXT PRIMARY KEY,
  slot TEXT,
  service TEXT,
  ts INTEGER,
  status TEXT DEFAULT 'booked'
);

INSERT OR IGNORE INTO availability (service, slot) VALUES
  ('cleaning', 'Thu 2:00 PM'),
  ('cleaning', 'Fri 11:00 AM'),
  ('cleaning', 'Mon 10:00 AM'),
  ('cleaning', 'Wed 3:00 PM');
```

---

## Project Structure

```
text-back-front-desk/
├── src/
│   └── index.ts          # Main entry: FrontDesk actor + webhook handlers
├── smoke_test.ts         # Verifies class/methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
└── .gitignore
```

---

## How It Works — Step by Step

### Step 1: Inbound SMS Triggers Actor Birth

**Code reference:** `fetch()` handler in `src/index.ts` — the `/webhook/inbound-message` route.

When a customer texts the clinic's number, Telnyx sends an `inbound-message` webhook to the Edge function. The handler:

1. Extracts `from` (customer's E.164), `to` (clinic number), and `text` from `body.data.payload`.
2. Derives the actor ID: `env.FRONT_DESK.idFromName(from)` — **one actor per customer**.
3. Gets a stub: `env.FRONT_DESK.get(actorId)`.
4. Forwards the message to the actor via `stub.fetch()` with a JSON body `{ text, from, to }`.

The actor is **self-provisioned** — no pre-registration needed. If it doesn't exist yet, the Agent SDK creates it on first access.

### Step 2: LLM Intent Classification

**Code reference:** `onMessage()` → `intent()` method.

Inside the actor, `onMessage()` pushes the customer's text to thread history, then calls `this.intent(text)`:

```typescript
const resp = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are a front-desk booking assistant..." },
    { role: "user", content: text },
  ],
});
```

The LLM returns JSON like:
```json
{ "action": "book", "service": "cleaning", "window": "next week" }
```

If parsing fails, it falls back to `{ action: "book", service: "cleaning", window: "next week" }`.

### Step 3: Availability Lookup via SQL

**Code reference:** `findSlots()` method.

The actor queries the SQL availability calendar:

```typescript
const stmt = this.env.APPOINTMENTS_DB.prepare(
  "SELECT slot FROM availability WHERE service = ? AND slot NOT IN (SELECT slot FROM appointments WHERE status = 'booked') ORDER BY slot LIMIT 4"
).bind(service);
```

This returns up to 4 available slots, excluding any already booked. If fewer than 2 are found, fallback slots are used.

### Step 4: Slot Offer via SMS

**Code reference:** `onMessage()` → `sendSms()` method.

The actor sends an SMS offer:

```
We can do Thu 2:00 PM or Fri 11:00 AM — which works?
```

Via `this.env.TELNYX.messages.send({ to, from, text })`. In **demo mode**, this logs to console instead of sending real SMS.

### Step 5: Customer Confirms → Booking + Reminders

**Code reference:** `book()` method.

When the customer replies "Thu 2pm", the actor:

1. **Inserts the appointment** into SQL:
   ```sql
   INSERT OR REPLACE INTO appointments(thread, slot, service, ts, status) VALUES(?, ?, ?, ?, 'booked')
   ```
2. **Updates state**: `bookedSlot`, `service`, `status = "booked"`, `reminded = { d1: false, h1: false }`.
3. **Schedules two reminders**:
   - `remind:<thread>:d1` — 24 hours before the slot
   - `remind:<thread>:h1` — 1 hour before the slot

   ```typescript
   this.schedule(d1Delay, "remind", { kind: "d1" }, { id: `remind:${thread}:d1` });
   this.schedule(h1Delay, "remind", { kind: "h1" }, { id: `remind:${thread}:h1` });
   ```

4. **Sends confirmation SMS**: `"Your cleaning is booked for Thu 2:00 PM with Dr. Okafor. See you then!"`

The `remind` task handler is a plain async method on the class, dispatched by name.

### Step 6: Rescheduling via Follow-Up Text

**Code reference:** `moveBooking()` method.

When the customer texts *"can I move it to Friday?"*:

1. The LLM classifies intent as `reschedule` with `window: "Friday"`.
2. `moveBooking()` calls `findSlots()` for the new window.
3. **Updates the SQL appointment**:
   ```sql
   UPDATE appointments SET slot = ? WHERE thread = ?
   ```
4. **Resets the `reminded` flags** to `{ d1: false, h1: false }`.
5. **Re-arms both reminders** with new delays calculated from the new slot time.
6. **Sends confirmation SMS**: `"Moved to Fri 11:00 AM. See you then!"`

The actor **re-wakes with full thread history** — the conversation, booking, and reminder state all persist across days and pod restarts.

### Step 7: 24h / 1h Reminder Ticks

**Code reference:** `remind()` method.

When a scheduled reminder fires, the Agent SDK calls:

```typescript
async remind({ kind }: { kind: "d1" | "h1" }): Promise<void>
```

The method:

1. **Checks the idempotent guard**: `if (state.reminded[kind]) return;` — prevents double reminders.
2. **Sends the reminder SMS**:
   ```
   Reminder: cleaning with Dr. Okafor Thu 2:00 PM. Reply R to reschedule or C to cancel.
   ```
3. **Sets the flag**: `state.reminded[kind] = true` and persists via `setState()`.

The `R` and `C` replies are handled by the same `onMessage()` flow — `R` triggers a reschedule intent, `C` triggers a cancel intent.

### Step 8: Delivery Update Retry

**Code reference:** `/webhook/delivery-update` route in `fetch()`.

When Telnyx reports a message as `undelivered` or `failed`:

1. The webhook handler extracts the `to` number and `status`.
2. If undeliverable, it forwards to the actor with `{ retryDelivery: true }`.
3. The actor's `retrySms()` method re-sends the message once.

This ensures critical reminders (like the 24h reminder) are retried if the first send fails.

### Step 9: Restart Proofing

**Code reference:** `book()` + `remind()` + `schedule()` with stable IDs.

The demo's interruption scenario:

1. Customer books a slot → appointment is in SQL, reminders are scheduled.
2. **Worker is killed** between the book and the 24h reminder.
3. On re-activation, the Agent SDK **re-arms the scheduled tasks** from durable storage.
4. The `remind:<thread>:d1` tick fires on time — the booking in SQL is intact.
5. The `reminded` guard prevents any double reminder.

This works because:
- **SQL appointments** are durable (not in-memory).
- **Scheduled tasks** are persisted by the Agent SDK with stable IDs (`remind:<thread>:d1`).
- **State** (including `reminded` flags) is persisted via `setState()`.

---

## Demo Mode vs Live Mode

The sample runs in **demo mode by default** (`DEMO_MODE = true` in `src/index.ts`).

### Demo Mode (default)

- **No real SMS sent.** `sendSms()` logs to console:
  ```
  [DEMO SMS] To: +15551234567 | From: +1555XXXXXXXX | Text: We can do Thu 2:00 PM or Fri 11:00 AM — which works?
  ```
- **No real charges.** Safe for local testing and CI.
- **LLM calls still work** (if `TELNYX_API_KEY` is set) — intent classification is real.

### Live Mode

To send real SMS:

1. Set `DEMO_MODE = false` in `src/index.ts`.
2. Ensure `TELNYX_API_KEY` is set as a secret.
3. Ensure `FRONT_DESK_NUMBER` is a real Telnyx number.
4. Deploy:
   ```bash
   telnyx-edge ship
   ```

> **Warning:** Live mode sends real SMS and incurs charges. Only enable after testing in demo mode.

---

## Running the Sample

### Local development (demo mode)

```bash
# Install dependencies
npm install

# Generate type definitions
npm run types

# Run smoke test
npx tsx smoke_test.ts

# Start the Edge runtime locally (if supported by your CLI version)
telnyx-edge dev
```

### Deploy to Telnyx Edge

```bash
# Set your Telnyx API key as a secret
telnyx-edge secrets add TELNYX_API_KEY "your_real_api_key"

# Deploy
telnyx-edge ship
```

After deployment, configure your Telnyx phone number's messaging profile to send webhooks to:

```
https://<your-deployment>.telnyx.dev/webhook/inbound-message
https://<your-deployment>.telnyx.dev/webhook/delivery-update
```

---

## Smoke Test

The `smoke_test.ts` file verifies that the `FrontDesk` class and its key methods exist and are callable:

```bash
npx tsx smoke_test.ts
```

Expected output:
```
✅ FrontDesk class loaded
✅ initialState() returns correct shape
✅ onMessage() is defined
✅ intent() is defined
✅ findSlots() is defined
✅ book() is defined
✅ remind() is defined
✅ moveBooking() is defined
✅ cancelBooking() is defined
✅ sendSms() is defined
✅ retrySms() is defined
✅ parseSlotToMs() is defined
```

---

## Next Steps

- **Customize the LLM prompt** in `intent()` to handle more service types (e.g., "checkup", "consultation", "extraction").
- **Add time-zone awareness** to `parseSlotToMs()` — currently it assumes the slot is in the local timezone of the server.
- **Integrate with a real calendar API** (Google Calendar, etc.) instead of the SQL availability table.
- **Add cancellation flow** — when the customer replies "C", cancel the appointment and free the slot.
- **Add multi-provider support** — extend the availability table with a `provider` column and let the customer choose.
- **Add payment integration** — collect a deposit via Telnyx Payments before confirming the booking.

### Useful Documentation Links

- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK: Message History](https://developers.telnyx.com/docs/agent-sdk/message-history)
- [Agent SDK: SQL Storage](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK: Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Agent SDK: Calling LLMs](https://developers.telnyx.com/docs/agent-sdk/concepts/calling-llms)
- [Stateful Actors on Telnyx Edge](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Send a Message API](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Inbound Message Callback](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Delivery Update Callback](https://developers.telnyx.com/api-reference/callbacks/delivery-update)
