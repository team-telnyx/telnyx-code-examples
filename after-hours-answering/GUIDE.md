# After-Hours Answering Line — Developer Guide

A step-by-step walkthrough of the `after-hours-answering` sample: a **durable Telnyx Edge Agent** that acts as a clinic's after-hours presence. It answers inbound calls live, captures the patient's need via AI speech-to-text, sends an immediate SMS confirmation, and schedules a callback for the next business morning — all while remembering callers across nights so returning patients are recognized without re-intake.

---

## Prerequisites

- A Telnyx account with an Edge Compute project
- Node.js 18+ (for local `telnyx-edge` CLI usage)
- The `telnyx-edge` CLI installed and authenticated:
  ```bash
  npm install -g @telnyx/edge-cli
  telnyx-edge auth api-key set <your_api_key>
  ```
- A Telnyx phone number provisioned and assigned to the clinic line (stored in `CLINIC_LINE`)

---

## Project Layout

```
after-hours-answering/
├── src/
│   └── index.ts          # The AfterHoursLine agent + webhook fetch handler
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor binding, secrets, SQL storage declaration
├── .env.example
├── smoke_test.ts         # Verifies the module loads without error
└── GUIDE.md              # This file
```

---

## Environment Setup

### 1. Declare bindings in `telnyx.toml`

The `telnyx.toml` file declares the durable actor binding, the Telnyx API binding, the SQL database, and the `TELNYX_API_KEY` secret:

```toml
name = "after-hours-answering"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "AFTER_HOURS_LINE"
type    = "AfterHoursLine"

[telnyx]
binding = "TELNYX"

[storage.sqldb.AFTERHOURS_DB]
id = "<sql-database-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[env_vars]
CLINIC_NAME = "Riverbend Family Health"
CLINIC_LINE = "+1555XXXXXXXX"
DEMO_MODE   = "true"
```

> Replace `<sql-database-uuid>` with your actual SQL database namespace ID from the Telnyx dashboard.

### 2. Set environment variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

`.env.example`:
```
TELNYX_API_KEY=your_telnyx_api_key_here
CLINIC_NAME=Riverbend Family Health
CLINIC_LINE=+1555XXXXXXXX
DEMO_MODE=true
```

### 3. Generate type definitions

After editing `telnyx.toml`, regenerate the TypeScript env types:

```bash
telnyx-edge types
```

This produces `telnyx-env.d.ts` with typed bindings for `AFTER_HOURS_LINE`, `TELNYX`, `AFTERHOURS_DB`, `SECRETS`, etc.

---

## How It Works — Step by Step

### Step 1: The Actor Is Born (Durable Per-Line Presence)

When a patient calls the clinic after hours, Telnyx sends a `call-initiated` webhook to `/webhook/call-initiated`. The fetch handler in `src/index.ts` extracts the `call.to` (the clinic's E.164 number) and uses it to derive a **durable actor ID**:

```typescript
const actor = e.AFTER_HOURS_LINE.idFromName(call.to);
const stub = e.AFTER_HOURS_LINE.get(actor);
await stub.fetch(new Request("https://internal/onCall", {
  method: "POST",
  body: JSON.stringify({ from: call.from, to: call.to, callControlId: call.call_control_id }),
}));
```

This means **one durable `AfterHoursLine` actor exists per clinic line**, self-provisioned on the first call. The actor persists across nights, weekends, and even Edge worker restarts — it is the clinic's after-hours presence, not a per-call ephemeral function.

### Step 2: Answer Live + Capture the Need (STT + LLM)

Inside `onCall`, the actor:

1. **Checks for idempotency** — if the same caller already logged a message today, it skips re-intake and sends a reminder SMS.
2. **Captures the patient's need** via `captureNeed()` — in demo mode this returns a synthetic reason (`"rash on arm"`, urgency `"medium"`); in live mode it calls the Telnyx AI binding's OpenAI-compatible chat completion to extract reason + urgency from the caller's speech.
3. **Stores the record** in the `afterhours` SQL table via `sqlExec`:

```sql
INSERT INTO afterhours(line, caller, reason, urgency, ts, smsSent, calledBack)
VALUES (?, ?, ?, ?, datetime('now'), 0, 0)
```

The SQL table is created at module load by `initSchema()`:

```sql
CREATE TABLE IF NOT EXISTS afterhours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line TEXT NOT NULL,
  caller TEXT NOT NULL,
  reason TEXT NOT NULL,
  urgency TEXT NOT NULL,
  ts TEXT NOT NULL,
  smsSent INTEGER DEFAULT 0,
  calledBack INTEGER DEFAULT 0
)
```

### Step 3: Send Immediate SMS Confirmation

The actor sends an SMS via the Telnyx messaging binding:

```typescript
await this.env.TELNYX.messages.create({
  to: caller,
  from: this.state.line,
  text: this.optionsSms(need.reason, need.urgency)
});
```

The SMS body looks like:

> We got your message about rash on arm. First slot: Mon 9:15am. Reply 1 to confirm a callback, 2 for the portal.

In demo mode, `sendSms()` logs `[DEMO SMS]` instead of sending a real message.

### Step 4: Patient Replies "1" → Arm Next-Business-Morning Callback

When the patient texts "1", Telnyx sends an `inbound-message` webhook to `/webhook/inbound-message`. The handler routes it to `onSmsReply`:

```typescript
if (trimmed === "1" || trimmed === "confirm") {
  const delaySec = Math.floor(this.msUntilNextBizMorning() / 1000);
  this.schedule(delaySec, "callback", {}, { id: `callback:${this.state.line}` });
  await this.sendSms(caller, "Callback confirmed for first thing tomorrow morning.");
}
```

The `schedule()` call uses the **Agent SDK's built-in scheduler** — no external cron, no Redis, no queue. The schedule ID is `callback:<line>`, so if the actor is killed and restarted, the same schedule re-arms automatically (restart-proof).

### Step 5: Morning Callback — Dial Back in Priority Order

At 9:00 AM the next business day, the actor's `callback()` method fires:

```typescript
const rows = await this.sqlQuery<AfterHoursRecord[]>(
  "SELECT * FROM afterhours WHERE line = ? AND calledBack = 0 ORDER BY CASE urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, ts ASC",
  [this.state.line]
);

for (const r of rows) {
  await this.dialBack(r);
  await this.sqlExec("UPDATE afterhours SET calledBack = 1 WHERE id = ?", [r.id]);
}
```

Each caller is dialed back via the Telnyx Call Control binding:

```typescript
await this.env.TELNYX.calls.create({
  from: this.state.line,
  to: record.caller,
  connection_id: "default",
});
```

The greeting includes the patient's reason: *"It's Riverbend Family Health — you reached us about the rash. A nurse is ready for you."*

### Step 6: Cross-Night Memory — Recognizing Returning Callers

If the same patient calls again on Monday about the same rash, the actor's `recognizeCaller()` method queries the SQL log:

```typescript
return await this.sqlQuery<AfterHoursRecord[]>(
  "SELECT reason, ts FROM afterhours WHERE caller = ? ORDER BY ts DESC LIMIT 5",
  [caller]
);
```

Because the actor is **durable and keyed by line** (not by call), it already has Saturday's record + conversation history. The actor can resume context: *"Right, the rash we spoke about — how is it today?"* — no re-intake needed.

### Step 7: Restart Proof — No Double Callbacks

If the Edge worker is killed between the SMS and the callback arm:

- The `afterhours` SQL row is already persisted (durable).
- The `smsSent` flag is set to `1` after the SMS is sent.
- The `schedule()` call with ID `callback:<line>` is re-armed on actor re-activation.
- The `calledBack` flag prevents double-dialing: `UPDATE afterhours SET calledBack = 1 WHERE id = ?` runs after each successful dial-back.

---

## Demo Mode vs Live Mode

| Feature | Demo Mode (`DEMO_MODE=true`) | Live Mode (`DEMO_MODE=false`) |
|---|---|---|
| Need capture | Returns synthetic `"rash on arm"` / `"medium"` | Calls `TELNYX.ai.openai.chat.completions.create` |
| SMS sending | Logs `[DEMO SMS]` to console | Sends real SMS via `TELNYX.messages.create` |
| Callback dialing | Logs `[DEMO DIALBACK]` to console | Places real outbound call via `TELNYX.calls.create` |
| Phone numbers | Masked in logs (`+1***XX`) | Real numbers used |

**Switch to live mode:**

```bash
telnyx-edge secrets add DEMO_MODE "false"
# or set in telnyx.toml env_vars
```

> ⚠️ In live mode, real SMS and calls will be placed. Ensure `CLINIC_LINE` is a real Telnyx-provisioned number.

---

## Key Telnyx Primitives Used

| Primitive | Where Used | Purpose |
|---|---|---|
| **Agent SDK** (`Agent<Env, State>`) | `class AfterHoursLine extends Agent` | The durable after-hours presence; owns state, SQL, schedule |
| **Agent SQL** (`this.env.AFTERHOURS_DB`) | `sqlExec`, `sqlQuery` | Persistent caller log + cross-night memory |
| **`schedule()`** | `onSmsReply` → `callback()` | Next-business-morning self-wake; no external cron |
| **Call Control** (`TELNYX.calls.create`) | `dialBack()` | Outbound callback dial |
| **Messaging** (`TELNYX.messages.create`) | `sendSms()` | SMS confirmation + two-way reply |
| **AI Inference** (`TELNYX.ai.openai.chat.completions.create`) | `captureNeed()` | STT + LLM extraction of reason + urgency |
| **StatefulActor storage** | `setState()` | Persists `lastCallbackAt` across restarts |

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that `src/index.ts` loads without error, the `AfterHoursLine` class is exported, and `initSchema` is callable.

---

## Deploying

```bash
telnyx-edge ship
```

This deploys the agent to Telnyx Edge. After deployment, configure your Telnyx phone number's voice webhook to point to:

```
https://<your-deployment>.telnyx.sh/webhook/call-initiated
```

And the messaging webhook to:

```
https://<your-deployment>.telnyx.sh/webhook/inbound-message
```

---

## Next Steps

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors on Telnyx Edge](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Gather Using AI (Speech-to-Text)](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Call Control — Dial Command](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Send a Message (SMS)](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Inbound Message Webhook Reference](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Edge CLI Reference](https://developers.telnyx.com/docs/edge-compute/cli)