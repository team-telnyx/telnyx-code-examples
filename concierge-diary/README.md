---
name: concierge-diary
title: "Concierge Diary — Follow-Up Calls the Assistant Books Itself"
description: "A durable per-conversation diary actor that turns an AI Assistant's post-conversation wrap-up turn into a personalized, exactly-once scheduled callback."
language: typescript
framework: edge
telnyx_products: [AI Assistants, Scheduled Events, Messaging, Edge Compute]
---

# Concierge Diary — Follow-Up Calls the Assistant Books Itself

A durable `DiaryActor` per conversation that receives the assistant's post-conversation intent, books a personalized scheduled callback, and survives restarts, reschedules, and cancellations without ever double-dialing.

## The Story

An imaging clinic's front desk makes callbacks all day long — "we'll call you Thursday at ten about the MRI results" — and every one of those promises is a small piece of patient trust that quietly expires if nobody dials, leaving the patient waiting on results that decide whether they schedule surgery while the clinic eats the no-show and the complaint. The actor IS the diary entry. It is born the instant a Tuesday-afternoon call ends, when the assistant's wrap-up turn decides a follow-up is warranted and hands over the patient's name, the reason, the exact callback time, and the sentence it should open with; it lives as one durable row per conversation holding the booking, the scheduled-event id, and a guard that says "this event has not been created yet." It survives the pod being killed in the half-second between writing the diary row and creating the event — the sweep timer wakes, sees the guard still set, and books the follow-up exactly once, never twice. On Thursday at ten it is delivered, and if the patient texts "can we do Friday instead?" on Wednesday it deletes the pending booking and re-books itself without losing the thread. The rest of this README is the API surface of that story.

## Why Telnyx

Two things had to be true at once for this sample to exist: the assistant had to be able to *think after the call ended*, and the platform had to be able to *act at a future timestamp*. Telnyx shipped both as **AI Communications Infrastructure** — post-conversation processing gives the assistant one extra LLM turn after the hangup (with HTTP tools it can call), and scheduled events let that turn's decision become a real outbound call on Thursday at 10:00 with per-event `dynamic_variables` carrying the personalized opener. Because both live on the same platform as the voice leg, the number, and the SMS confirmation, there is no third-party cron, no external job runner, and no glue service holding the booking. The diary actor owns the durable state; Telnyx owns the dial.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/ai/assistants` | Create the assistant with `post_conversation_settings.enabled: true` and a webhook tool pointed at `/diary/entries` (config-time, one-off) |
| `POST` | `/v2/ai/assistants/{assistant_id}/scheduled_events` | Book the follow-up call: `phone_call` channel, end-user + agent targets, `scheduled_at_fixed_datetime`, `dynamic_variables`, retry budget |
| `DELETE` | `/v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Drop the pending event on the reschedule and cancel paths |
| `POST` | `/v2/messages` | Confirmation SMS ("your callback is booked for …") via the zero-credential `TELNYX` binding |
| `POST` | `/diary/entries` | **Inbound** — the assistant's post-conversation webhook tool target (this sample's own actor route) |

## Architecture

```
  Tuesday 14:00 — patient calls the clinic line
        │
        ▼
  ┌────────────────────────────────────────────┐
  │ Telnyx AI Assistant (voice)                │
  │  · handles the scheduling conversation     │
  │  · post_conversation_settings.enabled      │
  └───────────────┬────────────────────────────┘
                  │ wrap-up turn → webhook tool
                  │ POST /diary/entries
                  │ {patientName, reason, callbackAt, opener, endUserTarget, agentTarget}
                  ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ DiaryActor   env.DIARY.idFromName(conversationId)            │
  │                                                              │
  │  state: { conversationId, patientName, topic, opener,        │
  │           callbackAt, eventId, status, createPending,        │
  │           pendingBody }                                      │
  │  SQL:   diary(conversation_id PK, patient, callback_at,      │
  │               status, event_id, topic, updated_at)           │
  │                                                              │
  │  onWebhook     → row "booked", createPending = true          │
  │                → this.schedule(sweep, "onSweep")             │
  │                → createPendingEvent()                        │
  │  onSweep       → if createPending: re-create exactly once    │
  │  onEventStatus → completed ⇒ "delivered" / failed ⇒ "failed" │
  │  onReschedule  → DELETE pending event, book replacement      │
  │  onCancel      → DELETE pending event, row "canceled"        │
  └───────────────┬──────────────────────────────────────────────┘
                  │ POST /v2/ai/assistants/{id}/scheduled_events
                  │   telnyx_conversation_channel: "phone_call"
                  │   scheduled_at_fixed_datetime: callbackAt
                  │   dynamic_variables: {patient_name, topic, clinic_name, opener}
                  │   max_retries_client_errors: 2, retry_interval_secs: 300
                  ▼
  ┌────────────────────────────────────────────┐
  │ Telnyx Scheduled Events executor           │
  │  Thursday 10:00 → dials the patient        │
  │  assistant opens with the dynamic opener   │
  └───────────────┬────────────────────────────┘
                  │ CallStatus = completed
                  ▼
        POST /diary/event-status → row "delivered"
```

The seam is the whole demo: the assistant's wrap-up turn is stateless and decides *whether*, *when*, and *what to say*; the actor is stateful and owns the row, the event id, and the exactly-once create guard. Kill the pod between the diary write and the event create and the sweep timer re-creates it once — `createPending` is the only thing standing between a restart and a duplicate phone call.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_ASSISTANT_ID` | `string` | `asst_01J9XK2Q8ZR4M0T7` | **yes** | Assistant that owns the scheduled events and whose post-conversation turn calls the diary webhook | Telnyx Portal → AI Assistants, or the `id` returned by `POST /v2/ai/assistants` |
| `TELNYX_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | E.164 number the confirmation SMS is sent from (must be on your account) | Telnyx Portal → Numbers |
| `CLINIC_NAME` | `string` | `Northside Imaging` | **yes** | Clinic name injected into `dynamic_variables.clinic_name` and the confirmation SMS | Your own config |
| `DIARY_WEBHOOK_SECRET` | `string` | `your_diary_webhook_secret_here` | live only | Shared secret the assistant's diary webhook tool sends as `Authorization: Bearer <secret>` (or `X-Diary-Token`). Required when `DEMO_MODE=false`; optional in demo mode | Your own config — point the assistant tool's auth header at it |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) logs the scheduled-event create/delete and SMS instead of placing them | — |
| `DIARY_SWEEP_SECONDS` | `string` | `120` | no | Delay before the `onSweep` recovery timer fires (default `120`) | — |

Bindings (declared in `telnyx.toml`, not env vars): `SECRETS` (holds `TELNYX_API_KEY`), `DIARY` (actor namespace), `DIARY_DB` (SQL database), `TELNYX` (zero-credential API binding for `messages.send`).

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/concierge-diary
cp .env.example .env
npm install
```

Authenticate the CLI and push the secret (the actor reads it through the `SECRETS` binding):

```bash
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
```

Confirm `telnyx.toml` declares the bindings this sample needs — `[[actors]] binding = "DIARY" type = "DiaryActor"`, `[storage.sqldb.DIARY_DB]`, `[[secrets]] binding = "TELNYX_API_KEY"`, and `[telnyx] binding = "TELNYX"` — then generate types and ship:

```bash
telnyx-edge types
telnyx-edge ship
```

Point the assistant's post-conversation webhook tool at `https://<your-actor-host>/diary/entries`, set `post_conversation_settings.enabled: true` on the assistant, and give the tool an `Authorization: Bearer <DIARY_WEBHOOK_SECRET>` header — in live mode (`DEMO_MODE=false`) the routes reject bookings without it. The sample runs in **safe demo mode** by default (`DEMO_MODE=true`): diary rows and state transitions are real, but no scheduled event is created and no SMS is sent — the calls are logged instead. Set `DEMO_MODE=false` for live mode. See `GUIDE.md` for the full demo-vs-live walkthrough.

## API Reference

All routes are served by the default export and dispatched to `env.DIARY.idFromName(conversationId)`. Every `POST` body must include `conversationId`.

### `GET /diary?conversationId=<id>`

Returns the actor's current state and its diary row.

```json
{
  "state": { "conversationId": "conv_01J...", "status": "booked", "eventId": "evt_01J...", "createPending": false },
  "rows": [{ "conversation_id": "conv_01J...", "patient": "Maya", "callback_at": "2026-11-12T10:00:00-08:00", "status": "booked", "event_id": "evt_01J...", "topic": "MRI results call" }]
}
```

### `POST /diary/entries` → `201`

The assistant's post-conversation webhook tool target. Validates the intent, writes the diary row as `booked`, arms the sweep timer, and creates the scheduled event.

```json
{
  "conversationId": "conv_01J...",
  "patientName": "Maya",
  "reason": "MRI results call",
  "callbackAt": "2026-11-12T10:00:00-08:00",
  "opener": "Maya, Dr. Chen's office — your MRI results are in.",
  "endUserTarget": "+1555XXXXXXXX",
  "agentTarget": "+1555XXXXXXXX"
}
```

`callbackAt` must be a future ISO-8601 timestamp; both targets must be E.164. Idempotent: a repeat call with the same `callbackAt` while `status === "booked"` returns the existing state without creating a second event.

### `POST /diary/reschedule`

Deletes the pending scheduled event, then books the replacement at the new time. `opener` is optional and falls back to the stored one.

```json
{ "conversationId": "conv_01J...", "callbackAt": "2026-11-13T10:00:00-08:00", "opener": "Maya, we moved your MRI results call to Friday." }
```

### `POST /diary/event-status`

Scheduled-event status callback. `completed` → row `delivered`; `failed` / `no_answer` → row `failed` plus an alert log. Events whose id does not match the stored `eventId` are ignored.

```json
{ "conversationId": "conv_01J...", "eventId": "evt_01J...", "callStatus": "completed" }
```

### `POST /diary/sweep`

Manual trigger for the recovery timer. Returns `{ "recreated": true, "eventId": "evt_01J..." }` when a pending create was replayed, `{ "recreated": false, "eventId": null }` otherwise.

### `POST /diary/cancel`

Patient opts out: deletes the pending event and closes the row as `canceled`.

```json
{ "conversationId": "conv_01J..." }
```

### Status codes

| Code | Meaning |
|------|---------|
| `200` | Read or state transition succeeded |
| `201` | Diary entry created |
| `400` | Missing/invalid field, non-JSON body, non-future `callbackAt`, non-E.164 phone |
| `404` | Unknown route, or no diary entry exists for the conversation |
| `405` | Method not allowed on the actor route |
| `500` | Upstream Telnyx call failed (details logged, never returned) |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `400 callbackAt must be a future ISO-8601 timestamp` | The assistant sent a relative time or a past timestamp | Have the wrap-up turn resolve the time to an absolute ISO-8601 string with offset before calling the tool |
| `400 endUserTarget must be an E.164 number` | Number arrived as `(510) 555-0142` | Normalize to `+15105550142` in the assistant's tool arguments |
| No follow-up call placed | `DEMO_MODE` still `true` | Set `DEMO_MODE=false` and re-ship; check the deploy logs for `[demo] would create scheduled event` |
| `scheduled event create failed with status 401` | `TELNYX_API_KEY` secret not set on the deployment | `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `scheduled event create failed with status 422` | `TELNYX_ASSISTANT_ID` wrong, or `agentTarget` not attached to the assistant | Verify the assistant id and that the agent target number is assigned to it |
| Two follow-up calls for one conversation | A second `POST /diary/entries` arrived with a *different* `callbackAt` | Expected — a changed time is a re-book. Same-time repeats are deduped by the `booked` guard |
| Row stuck at `booked`, `createPending: true` | Pod died between the diary write and the event create | Wait for `DIARY_SWEEP_SECONDS`, or `POST /diary/sweep` to replay it immediately |
| `DELETE` returns 404 on reschedule | Event already fired or was removed | Treated as success by design; the replacement is still booked |
| Confirmation SMS never arrives | `TELNYX_FROM_NUMBER` not on the account, or demo mode | Check the number in the portal; SMS failures are logged but never block the booking |

## Agent Discovery

- Agent signup and onboarding: <https://telnyx.com/agent-signup.md>
- Telnyx AI examples and agent tooling: <https://github.com/team-telnyx/ai>
- Machine-readable docs index: <https://developers.telnyx.com/llms.txt>

## Related Examples

- **DEV-1348 — retry forensics on scheduled events**: same events API, actor-side inspection of `max_retries_client_errors` / `retry_interval_secs` outcomes. This sample sets the retry budget but treats retry mechanics as that sample's ground.
- **DEV-816 — snooze reminders**: uses the agent's own `this.schedule()` for in-actor timers rather than Telnyx scheduled events.
- **`edge-compute-statefulactor`**: the Agent SDK reference sample this project's actor structure derives from.
- Post-call webhook patterns from Vapi/Retell, reimplemented on Telnyx post-conversation processing.

## Resources

- Post-conversation processing: <https://developers.telnyx.com/docs/inference/ai-assistants/post-conversation-processing>
- Scheduled events guide: <https://developers.telnyx.com/docs/inference/ai-assistants/scheduled-events>
- Create a scheduled event (API reference): <https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event>
- Delete a scheduled event (API reference): <https://developers.telnyx.com/api-reference/assistants/delete-a-scheduled-event>
- Agent SDK docs: <https://developers.telnyx.com/docs/agent-sdk>
- AI Assistants product page: <https://telnyx.com/products/ai-assistants>
- Pricing: <https://telnyx.com/pricing>
