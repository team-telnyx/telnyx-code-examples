# The Concierge Diary — a follow-up booker that books itself

A walkthrough of `concierge-diary`, a Telnyx Edge sample where **the actor is the diary entry**. One durable `DiaryActor` per conversation owns the diary row, the scheduled-event id, and the exactly-once create guard. The AI Assistant's post-conversation wrap-up turn decides *whether* a follow-up is needed, *when* it should happen, and *what to say* — then calls the actor's webhook tool. The actor books the follow-up call on the Telnyx scheduled-events API with the personalized opener carried in `dynamic_variables`.

By the end of this guide you'll understand:

- how the assistant's post-conversation turn hands intent to a durable actor,
- how `env.DIARY.idFromName(conversationId)` gives you one diary entry per conversation,
- how the actor creates, deletes, and re-creates scheduled events,
- how the `createPending` guard plus a `this.schedule()` sweep timer makes the create exactly-once across pod restarts,
- how the diary table records `booked → delivered → rescheduled → canceled`.

---

## 1. The idea in one paragraph

A patient calls the imaging clinic on Tuesday at 2pm. The assistant handles the scheduling conversation, the call ends, and the assistant's **post-conversation processing** turn fires. That extra LLM turn decides the clinic owes Maya a callback Thursday at 10 about her MRI results, and it calls the diary webhook tool with the patient name, the reason, the timestamp, and a personalized opener. The `DiaryActor` for that conversation writes the diary row and creates a **scheduled event** on the assistant. Thursday at 10:00 the executor dials Maya and the assistant opens with the dynamic opener. When the call completes, the status callback marks the row `delivered`.

The seam between post-conversation processing and scheduled events is the whole demo. The assistant is stateless after the call ends — it cannot hold a Thursday booking by itself. The actor can.

---

## 2. Prerequisites

- Node.js 20+
- The `telnyx-edge` CLI (`npm i -g telnyx-edge` or use `npx telnyx-edge`)
- A Telnyx account with:
  - an API key,
  - an AI Assistant (created with `post_conversation_settings.enabled: true`),
  - a phone number that can place outbound calls and send SMS.
- A Telnyx Edge project (this sample) deployed with `telnyx-edge ship`.

You do **not** need a separate Telnyx SDK install — the sample talks to the scheduled-events REST API directly and uses the zero-credential `TELNYX` binding for SMS.

---

## 3. Project layout

```
concierge-diary/
├── src/index.ts        # the whole sample: router + DiaryActor
├── telnyx.toml         # actor, secrets, SQL, TELNYX binding, env vars
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── API.md
└── GUIDE.md            # this file
```

Everything interesting lives in `src/index.ts`. It has three layers:

1. **Validation helpers** (`validateDiaryIntent`, `buildScheduledEventPayload`, `field`, `phone`, `futureIso`) — pure functions, no I/O.
2. **`DiaryActor`** — the durable entity. Owns state, the diary table, and the scheduled-event lifecycle.
3. **The default export `fetch`** — a thin router that maps `POST /diary/<route>` to `env.DIARY.idFromName(conversationId)`.

---

## 4. Environment and bindings

### 4.1 `telnyx.toml`

The bindings the code expects:

```toml
name = "concierge-diary"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "DIARY"
type    = "DiaryActor"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[storage.sqldb.DIARY_DB]
id = "<sqldb-namespace-uuid>"

[telnyx]
binding = "TELNYX"

[env_vars]
TELNYX_ASSISTANT_ID = "assistant-xxxxxxxx"
TELNYX_FROM_NUMBER  = "+1555XXXXXXXX"
CLINIC_NAME         = "Dr. Chen's Imaging"
DEMO_MODE           = "true"
DIARY_SWEEP_SECONDS = "120"
```

### 4.2 Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | `apiKey()` via `SECRETS` | Bearer token for the scheduled-events REST calls. Never in code. |
| `TELNYX_ASSISTANT_ID` | `createScheduledEvent`, `deleteScheduledEvent` | Which assistant owns the scheduled event. |
| `TELNYX_FROM_NUMBER` | `sendConfirmation` | Sender for the "your callback is booked" SMS. |
| `CLINIC_NAME` | `buildScheduledEventPayload`, `sendConfirmation` | Injected into `dynamic_variables.clinic_name` and the SMS body. |
| `DEMO_MODE` | `demoMode()` | `"true"` (default) logs instead of calling Telnyx. `"false"` goes live. |
| `DIARY_SWEEP_SECONDS` | `sweepSeconds()` | Delay before the recovery sweep runs. Defaults to 120. |

`.env.example` ships placeholders only — no real numbers, no real keys.

### 4.3 Setting the secret

```bash
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_API_KEY>"
telnyx-edge types      # regenerate telnyx-env.d.ts from telnyx.toml
```

---

## 5. Demo mode vs live mode

The sample is **safe by default**. `demoMode()` returns `true` unless `DEMO_MODE` is explicitly `"false"`, and three call sites branch on it:

| Function | Demo behaviour | Live behaviour |
|---|---|---|
| `createScheduledEvent` | logs the intent and returns a synthetic id `demo_evt_<conversationId>_<epochMs>` | `POST /v2/ai/assistants/{id}/scheduled_events` |
| `deleteScheduledEvent` | logs the delete | `DELETE /v2/ai/assistants/{id}/scheduled_events/{eventId}` |
| `sendConfirmation` | logs the masked recipient | `this.env.TELNYX.messages.send(...)` |

Everything else — state transitions, the diary table, the sweep timer, the exactly-once guard — runs identically in both modes. That's deliberate: you can exercise the full lifecycle, including the crash-recovery path, without placing a single call.

**To go live**, set `DEMO_MODE=false` in `telnyx.toml` `[env_vars]` (or via the dashboard), point `TELNYX_ASSISTANT_ID` at a real assistant, and set `TELNYX_FROM_NUMBER` to a number you own. Re-ship with `telnyx-edge ship`.

---

## 6. Walkthrough

### 6.1 The router — one actor per conversation

The default export in `src/index.ts` is the front door. It does almost nothing, on purpose:

```ts
const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
if (!conversationId) return json({ error: "conversationId is required" }, 400);

return env.DIARY.idFromName(conversationId).fetch(
  new Request(`https://diary.internal/diary/${segments[1]}`, { ... }),
);
```

`idFromName(conversationId)` is the load-bearing line. It deterministically maps a conversation to a single actor instance, so every webhook for the same conversation lands on the same durable state — no lookup table, no race between two pods. The `ROUTES` set (`entries`, `reschedule`, `event-status`, `sweep`, `cancel`) gates which paths are forwarded; anything else 404s before it reaches an actor.

`GET /diary?conversationId=...` is the read path — it forwards to the actor's `GET /diary` handler, which returns both the live state and the SQL row.

### 6.2 The actor's state shape

`DiaryState` is the diary entry. It carries the conversation id, the patient name, the topic, the opener, the callback timestamp, both phone targets, the scheduled `eventId`, the current `status`, and — critically — `createPending` plus `pendingBody`.

`createPending` / `pendingBody` are the crash-recovery pair. `pendingBody` holds the exact intent that still needs to become a scheduled event; `createPending` says whether that work is outstanding. Both are written to durable state *before* the network call, which is what makes recovery possible.

`initialState()` returns an empty `status: "new"` entry. `getState()` / `replaceState()` come from the Agent SDK and are durable across restarts.

### 6.3 The post-conversation webhook — `onWebhook`

This is the seam. The assistant's wrap-up turn calls `POST /diary/entries` with the full intent. `validateDiaryIntent` runs first:

- `field()` enforces presence, trims, and caps length (`patientName` ≤ 120, `reason` ≤ 200, `opener` ≤ 400, `conversationId` ≤ 128).
- `phone()` enforces E.164 on `endUserTarget` and `agentTarget`.
- `futureIso()` parses `callbackAt` and rejects anything not in the future.

Any failure throws `HttpError(400, ...)`, which the actor's `fetch` catch block turns into a clean JSON error. No stack traces leak.

`onWebhook` then does an idempotency check — if the same conversation already has a booked event at the same timestamp, it returns the existing state untouched. Otherwise it:

1. `replaceState(...)` with the new intent, `eventId: null`, `status: "booked"`, `createPending: true`, `pendingBody: intent`.
2. `writeRow("booked", null)` — the diary row exists before any network call.
3. `this.schedule(this.sweepSeconds(), "onSweep", { conversationId })` — arms the recovery timer.
4. `createPendingEvent("booked")` — attempts the actual create.

Steps 1–3 are durable. Step 4 is the only thing that can be lost to a pod kill, and step 3 exists to catch exactly that.

### 6.4 Building the scheduled event — `buildScheduledEventPayload`

A pure function, easy to unit-test, that turns a `DiaryIntent` into the wire payload:

```ts
{
  telnyx_conversation_channel: "phone_call",
  telnyx_end_user_target: intent.endUserTarget,
  telnyx_agent_target: intent.agentTarget,
  scheduled_at_fixed_datetime: intent.callbackAt,
  dynamic_variables: {
    patient_name: intent.patientName,
    topic: intent.reason,
    clinic_name: clinicName,
    opener: intent.opener,
  },
  max_retries_client_errors: 2,
  retry_interval_secs: 300,
}
```

Two things to notice.

**`dynamic_variables` is the personalization.** The assistant's prompt references `{{patient_name}}`, `{{topic}}`, `{{clinic_name}}`, and `{{opener}}`. When the executor dials Thursday at 10, those resolve per-event — which is why the follow-up transcript contains "Maya" and "MRI results" rather than a generic greeting. The `opener` variable is the assistant's own sentence, captured at wrap-up time when it still had the full conversation in context.

**The retry fields are legal on `phone_call` events.** `max_retries_client_errors: 2` with `retry_interval_secs: 300` means a no-answer follow-up retries twice on its own, five minutes apart. The diary's value is the intent and the personalization, not the retry mechanics — but the fields are accepted (no 400) and they're set here so the demo behaves like a real clinic.

### 6.5 Creating the event — `createScheduledEvent`

In live mode this is a raw `POST` to `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/scheduled_events` with a Bearer token pulled from `SECRETS`. The sample uses raw REST rather than a typed SDK resource because the typed `assistants.scheduledEvents` surface isn't guaranteed on the edge binding — an `AttributeError` at runtime is worse than an explicit `fetch`.

The response envelope is unwrapped as `{ data: { id } }`. A non-2xx status or a missing id throws, which propagates up through `createPendingEvent` and leaves `createPending: true` in state — the sweep will retry.

### 6.6 The exactly-once guard — `createPendingEvent` + `onSweep`

This is the part worth reading twice.

```ts
private async createPendingEvent(status: DiaryStatus): Promise<void> {
  const state = await this.getState();
  if (!state.createPending || !state.pendingBody) return;   // guard
  const intent = state.pendingBody;
  const eventId = await this.createScheduledEvent(intent);
  await this.replaceState({ ...state, eventId, status, createPending: false, pendingBody: null });
  await this.writeRow(status, eventId);
  await this.sendConfirmation(intent);
}
```

The guard is the first two lines: if `createPending` is false, there is nothing to do. Because `createPending` is flipped to `false` in the same durable write that records the `eventId`, a second invocation — whether from a retried webhook or from the sweep timer — sees `false` and returns immediately. No duplicate events.

`onSweep` is the recovery path:

```ts
async onSweep(): Promise<{ recreated: boolean; eventId: string | null }> {
  const state = await this.getState();
  if (!state.createPending) return { recreated: false, eventId: state.eventId };
  await this.createPendingEvent(state.status === "rescheduled" ? "rescheduled" : "booked");
  return { recreated: true, eventId: (await this.getState()).eventId };
}
```

The scenario it covers: the pod is killed after `writeRow("booked", null)` and the `schedule()` call, but before the create lands. `createPending` is still `true` in durable state. When the timer fires — on whatever pod picks the actor up — `onSweep` sees the flag, re-runs `createPendingEvent`, and the event is created exactly once. If the create *did* land before the kill, `createPending` is already `false` and the sweep is a no-op.

`onSweep` is also reachable directly via `POST /diary/sweep`, which is how you force the recovery path in a test without actually killing a pod.

### 6.7 The diary table — `ensureSchema`, `writeRow`, `readRows`

The actor's SQL binding (`DIARY_DB`) holds the timeline:

```sql
CREATE TABLE IF NOT EXISTS diary (
  conversation_id TEXT PRIMARY KEY,
  patient         TEXT NOT NULL,
  callback_at     TEXT NOT NULL,
  status          TEXT NOT NULL,
  event_id        TEXT,
  topic           TEXT,
  updated_at      TEXT NOT NULL
)
```

`writeRow(status, eventId)` is an upsert keyed on `conversation_id` — one row per conversation, updated in place as the entry moves through its lifecycle. `ensureSchema` runs before every write and read, so the table exists on a cold actor without a migration step.

`readRows()` selects the single row for this actor's conversation and is returned alongside `getState()` from `GET /diary`. That's the "diary view" from the demo flow: `booked`, `delivered`, `rescheduled`, `canceled`, one timeline per conversation.

### 6.8 The follow-up call and the status callback — `onEventStatus`

Thursday at 10:00 the executor dials. The assistant opens with the resolved `opener` variable. When the call finishes, Telnyx posts the event status to `POST /diary/event-status`:

```ts
if (!eventId || eventId !== state.eventId) return state;
if (callStatus === "completed") {
  await this.replaceState({ ...state, status: "delivered" });
  await this.writeRow("delivered", eventId);
} else if (callStatus === "failed" || callStatus === "no_answer") {
  await this.replaceState({ ...state, status: "failed" });
  await this.writeRow("failed", eventId);
  console.error(`follow-up call did not connect for conversation ${state.conversationId}`);
}
```

The `eventId !== state.eventId` check matters: a stale callback from a superseded event (say, one that was deleted during a reschedule) is ignored rather than corrupting the current row. Note the failure log carries the conversation id only — no phone numbers, no patient name.

### 6.9 Reschedule — `onReschedule` + `deleteScheduledEvent`

Wednesday the patient texts "can we do Friday instead?" The assistant's wrap-up turn calls `POST /diary/reschedule` with the new `callbackAt` (and optionally a new `opener`; otherwise the previous one is reused).

The handler:

1. Validates the new timestamp with `futureIso`.
2. `deleteScheduledEvent(state.eventId)` — `DELETE /v2/ai/assistants/{id}/scheduled_events/{eventId}`. A 404 is tolerated (the event may already have fired or been removed); any other non-2xx throws.
3. Rebuilds the intent from existing state plus the new timestamp.
4. `replaceState(...)` with `eventId: null`, `status: "rescheduled"`, `createPending: true`, `pendingBody: intent`.
5. `writeRow("rescheduled", null)`.
6. Re-arms the sweep timer.
7. `createPendingEvent("rescheduled")` — books the replacement.

The delete-then-create ordering means there is a window where no event exists. That's intentional and safe: `createPending` is `true` throughout, so a crash in the window is recovered by the sweep, and the guard prevents a double-book.

### 6.10 Cancel — `onCancel`

The opt-out path. Deletes the pending event if there is one, then writes `status: "canceled"`, clears `eventId`, `createPending`, and `pendingBody`, and upserts the row. No new event is created, and the sweep becomes a no-op because `createPending` is `false`.

### 6.11 The confirmation SMS — `sendConfirmation`

After a successful create, the actor texts the patient:

```
${CLINIC_NAME}: your callback is booked for ${callbackAt}. Reply RESCHEDULE to move it.
```

Sent through the zero-credential `TELNYX` binding (`this.env.TELNYX.messages.send({ to, from, text })`) — the platform injects auth, so no API key touches this path. The send is wrapped in try/catch and logs only the error message on failure: a failed confirmation must never roll back a booked event.

---

## 7. Configuring the assistant

Two settings on the assistant make the seam work.

**Post-conversation processing.** On `POST /v2/ai/assistants`, set:

```json
{ "post_conversation_settings": { "enabled": true } }
```

This gives the assistant one extra LLM turn after the conversation ends, with the full transcript in context and the ability to call HTTP tools. That turn is where "she needs a callback Thursday at 10 about the MRI results" gets decided.

**The diary webhook tool.** Register an HTTP tool pointing at your deployed actor:

```
POST https://<your-edge-host>/diary/entries
{
  "conversationId": "{{conversation_id}}",
  "patientName":    "{{patient_name}}",
  "reason":         "{{follow_up_reason}}",
  "callbackAt":     "{{callback_at_iso8601}}",
  "opener":         "{{personalized_opener}}",
  "endUserTarget":  "{{caller_e164}}",
  "agentTarget":    "{{clinic_number_e164}}"
}
```

The tool description should tell the model *when* to call it — "call this only if the caller needs a future follow-up, and only with a timestamp you have confirmed with them." The model decides whether, when, and what to say; the actor decides how to make it durable.

A second tool for the reschedule path posts to `/diary/reschedule` with `conversationId` and the new `callbackAt`.

---

## 8. Running it

```bash
# 1. install
npm install

# 2. generate types from telnyx.toml
npx telnyx-edge types

# 3. set the secret
npx telnyx-edge secrets add TELNYX_API_KEY "<YOUR_API_KEY>"

# 4. ship
npx telnyx-edge ship

# 5. confirm the actor is live
npx telnyx-edge actors list
```

Demo mode is on by default — the first run places no calls and sends no SMS.

---

## 9. Exercising the flow

All POST routes require `conversationId` in the body; the router uses it to pick the actor.

**Book a follow-up (the post-conversation webhook):**

```bash
curl -X POST https://<your-edge-host>/diary/entries \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv_abc123",
    "patientName": "Maya",
    "reason": "MRI results call",
    "callbackAt": "2026-11-12T10:00:00-08:00",
    "opener": "Maya, Dr. Chen'\''s office — your MRI results are in.",
    "endUserTarget": "+1555XXXXXXX",
    "agentTarget": "+1555YYYYYYY"
  }'
```

Expect `201` with `status: "booked"` and a non-null `eventId` (a `demo_evt_...` id in demo mode).

**Read the diary:**

```bash
curl 'https://<your-edge-host>/diary?conversationId=conv_abc123'
```

Returns `{ state, rows }` — the live state plus the SQL row.

**Simulate the call completing:**

```bash
curl -X POST https://<your-edge-host>/diary/event-status \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"conv_abc123","eventId":"<eventId from the previous call>","callStatus":"completed"}'
```

Row flips to `delivered`.

**Reschedule:**

```bash
curl -X POST https://<your-edge-host>/diary/reschedule \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"conv_abc123","callbackAt":"2026-11-13T14:00:00-08:00"}'
```

Row flips to `rescheduled`, the old event is deleted, a new one is created.

**Force the recovery sweep:**

```bash
curl -X POST https://<your-edge-host>/diary/sweep \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"conv_abc123"}'
```

Returns `{ recreated: false, eventId: "..." }` when nothing is outstanding — which is the proof that the guard holds.

**Cancel:**

```bash
curl -X POST https://<your-edge-host>/diary/cancel \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"conv_abc123"}'
```

---

## 10. What to watch for

| Symptom | Likely cause |
|---|---|
| `400 callbackAt must be a future ISO-8601 timestamp` | The assistant passed a relative phrase ("Thursday") instead of a resolved timestamp. Tighten the tool description. |
| `400 endUserTarget must be an E.164 number` | The caller id wasn't normalized. Have the tool pass `{{caller_e164}}`. |
| `500 scheduled event create failed with status 401` | `TELNYX_API_KEY` secret missing or not set on the deployed actor. |
| Sweep keeps returning `recreated: true` | The create is failing every time — check the API key and `TELNYX_ASSISTANT_ID`. |
| Follow-up call opens with `{{opener}}` literal | The assistant prompt doesn't reference the dynamic variable, or the event was created without `dynamic_variables`. |
| Two events for one conversation | Something bypassed `createPendingEvent` — check that all create paths go through the guard. |

---

## 11. Next steps

- [Post-conversation processing](https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing) — the wrap-up turn that decides whether a follow-up is needed.
- [Scheduled events](https://developers.telnyx.com/docs/inference/ai-assistants/scheduled-events) — the full lifecycle, channels, and dynamic variables.
- [Create a scheduled event](https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event) — the exact request shape this sample builds.
- [Delete a scheduled event](https://developers.telnyx.com/api-reference/assistants/delete-a-scheduled-event) — the reschedule path.
- [Agent SDK](https://developers.telnyx.com/docs/agent-sdk) — durable state, `this.schedule()`, SQL bindings, and the actor model.

Related samples in this repo:

- **DEV-1348** — retry forensics on the same scheduled-events API, actor-side. If you want to understand what happens when a follow-up doesn't connect, start there.
- **DEV-816** — snooze reminders built on the agent's own `this.schedule()`. A useful contrast: that sample schedules *itself*, this one schedules *the assistant*.

The pattern generalizes past clinics. Recruiters booking candidate check-ins, sales teams booking post-demo follow-ups, any vertical where a human conversation ends with "I'll call you Thursday" — the actor is the diary, the assistant is the concierge.
