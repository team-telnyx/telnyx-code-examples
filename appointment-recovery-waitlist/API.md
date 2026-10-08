# API Reference — appointment-recovery-waitlist

All routes are served by the deployed Edge function. In `DEMO_MODE=true`
(default) the `/demo/*` endpoints are enabled; in `DEMO_MODE=false` they
return `403` and all inbound webhooks are verified against
`TELNYX_PUBLIC_KEY` (Telnyx Ed25519).

Types below mirror `src/index.ts`.

---

## `GET /health`

Liveness probe.

**Response**

```json
{ "status": "ok", "agent": "AppointmentSlot" }
```

---

## `POST /webhook/scheduling`

The mock scheduling webhook — this is where the slot actor is **born**.
Resolves `env.SLOTS.idFromName(slotId)` and invokes the `@rpc openSlot`
method; one durable actor per appointment slot.

**Request body** — `OpenSlotPayload`

| Field | Type | Required | Description |
|---|---|---|---|
| `slotId` | `string` | yes | Stable slot identifier, e.g. `"SLOT-8217"` |
| `provider` | `string` | yes | Provider name shown in outreach, e.g. `"Dr. Okafor"` |
| `startsAt` | `string` | yes | ISO datetime of the slot, e.g. `"2026-10-08T10:00:00"` |
| `missedPatient` | `{ name: string; phone: string }` | yes | Patient who missed/canceled (E.164 phone) |
| `waitlist` | `Array<{ name: string; phone: string; priority: number }>` | no | Sorted by `priority` ascending (1 fills first) |

**Response**

```json
{ "ok": true, "slotId": "SLOT-8217" }
```

**Errors** — `400` when `slotId`, `provider`, `startsAt` or a valid
`missedPatient.phone` is missing; `500` on actor failure.

**Side effects** — actor state initialized; `outreach_attempts` row appended;
expiry timer scheduled (`SLOT_EXPIRY_MIN`); missed-patient recovery call
started (voice first, `WAITLIST_REPLY_TIMEOUT_MIN` sweep window).

---

## `POST /webhook/inbound-message`

Telnyx `message.received` callback (in live mode, signature-verified).

**Request body** — Telnyx webhook envelope

```json
{
  "data": {
    "event_type": "message.received",
    "payload": { "from": { "phone_number": "+15557000003" }, "text": "YES" }
  }
}
```

**Routing** — the reply resolves to a slot actor in this order:

1. an explicit slot reference parsed from the text (`slot-XXXX`),
2. the shared `SlotIndex` actor (`patient E.164 → { slotId, role }`),
3. a generic help reply when neither matches.

**Response**

```json
{ "ok": true, "reply": "Confirmed: Dr. Okafor at 2026-10-08T10:00:00 (America/New_York). Reply CANCEL to release.", "decision": "confirm" }
```

| `decision` | Meaning |
|---|---|
| `"confirm"` | First confirmation wins → slot filled; all further outreach stops |
| `"reschedule"` | Missed patient rebooked → recovery workflow closed |
| `"later"` | Retry scheduled within the current outreach budget |
| `"decline"` | Missed patient → waitlist fill starts; waitlist patient → cursor advances |

---

## `POST /webhook/assistant-tool`

The AI Assistant's `report_outcome` webhook tool lands here during a live
call. The body is the **flat arguments object** — `{intent}` from the model
plus `slot_id` and `caller_phone` injected server-side via
`preset_body_fields`. In live mode the Ed25519 signature headers
(`telnyx-signature-ed25519` + `telnyx-timestamp`) are verified before the
request is trusted.

**Response** (returned to the assistant as the tool result):

```json
{ "ok": true, "recorded": true, "reply": "you're all set — rebooked for dr. okafor on thursday, october 8 at 10:00 am. we'll follow up by text.", "slotStatus": "rescheduled" }
```

`"recorded": false` with an explanatory `reply` covers races (slot already
claimed), closed slots, and unmatched callers — the assistant speaks the
`reply` to the patient.

---

## `GET /` and `GET /api/dashboard`

The demo dashboard. `GET /` serves the dark auto-refreshing UI (2s polling of
`GET /api/dashboard`), which returns one card per tracked slot:

```json
{
  "slots": [
    {
      "slotId": "SLOT-8217",
      "provider": "Dr. Okafor",
      "startsAt": "2026-10-08T10:00:00",
      "snapshot": { "status": "offering", "cursor": 0, "currentCandidate": { "...": "..." }, "confirmation": null },
      "ledger": { "attempts": [ { "...": "..." } ], "confirmation": null }
    }
  ]
}
```

Slots are tracked on `openSlot` and untracked when they resolve (filled,
rescheduled, expired, unresolved). Patient phone numbers are masked in the UI
for demo recordings.

---

## `POST /webhook/call-events`

Telnyx Call Control event webhook (in live mode, signature-verified).

**Routing** — the call is routed to its slot actor via `payload.client_state`
(base64 `{ "slotId": "…" }`, set when the actor dialed) or, when absent, via
the `SlotIndex` fallback (`payload.to`).

**Handled events**

| `event_type` | Actor behavior |
|---|---|
| `call.answered` | Records `answered` in the ledger, speaks the offer (`/actions/speak`) |
| `call.speak.ended` | Starts `gather_using_ai` to classify the spoken reply |
| `call.ai_gather.ended` | Parses `payload.result.intent` (or `utterance`), applies the decision, hangs up |
| `call.ai_gather.failed` | Records `no_answer`, hangs up — the sweep timer decides retry vs next candidate |
| `call.hangup` | Records `no_answer`; the sweep timer decides retry vs next candidate |

**Response**

```json
{ "ok": true, "handled": true, "decision": "confirm" }
```

`"handled": false` means the event did not match the slot's current candidate
(stale event, wrong slot, or closed slot).

---

## `POST /demo/reply` — demo mode only

Simulates a patient's SMS reply against a slot actor. Drives the same
actor-owned state machine as real inbound webhooks.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `slotId` | `string` | no | Explicit slot; falls back to the `SlotIndex` |
| `from` | `string` | yes | Patient E.164 |
| `text` | `string` | yes | Reply text (decision keywords: `RESCHEDULE`, `LATER`, `DECLINE`, `YES`, `NO`) |

**Response** — same shape as `/webhook/inbound-message`.

**Errors** — `403` when `DEMO_MODE=false`.

---

## `POST /demo/call-event` — demo mode only

Simulates a Call Control event for a slot (demo voice path).

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `slotId` | `string` | yes | Slot identifier |
| `eventType` | `string` | yes | `call.answered`, `call.ai-gather-ended`, `call.hangup` |
| `intent` | `string` | no | For `call.ai-gather-ended`: `reschedule` / `later` / `decline` / `confirm` |
| `to` | `string` | no | Callee E.164 (matching check) |
| `callControlId` | `string` | no | Matching check (usually empty in demo) |

**Response** — same shape as `/webhook/call-events`.

**Errors** — `403` when `DEMO_MODE=false`.

---

## `GET /state/:slotId`

Read-only snapshot of the slot actor — used by demos and the restart proof
(kill the actor, query, verify the cursor and lock survived).

**Response** — `SlotSnapshot`

```json
{
  "slotId": "SLOT-8217",
  "status": "filled",
  "provider": "Dr. Okafor",
  "startsAt": "2026-10-08T10:00:00",
  "cursor": 0,
  "waitlistLength": 3,
  "currentCandidate": {
    "name": "Casey Doyle",
    "phone": "+15557000003",
    "role": "waitlist",
    "channel": "voice",
    "attempts": 1,
    "callControlId": null
  },
  "confirmation": {
    "patient": "+15557000003",
    "confirmedAt": 1760000000000,
    "source": "sms"
  },
  "generation": 3
}
```

| `status` | Meaning |
|---|---|
| `open` | Slot opened, outreach not yet started |
| `offering` | A candidate (missed patient or waitlist) is being contacted |
| `filled` | A patient confirmed — terminal |
| `rescheduled` | Missed patient rebooked — terminal |
| `expired` | `SLOT_EXPIRY_MIN` elapsed without a confirmation — terminal |
| `unresolved` | Waitlist exhausted without a confirmation — terminal |

---

## `GET /ledger/:slotId`

Outreach ledger snapshot — every call/SMS attempt, response, timeout, and the
final outcome.

**Response**

```json
{
  "attempts": [
    { "slotId": "SLOT-8217", "patient": "+15557000001", "channel": "sms", "status": "closed",     "detail": "slot opened: Dr. Okafor @ 2026-10-08T10:00:00, waitlist=3", "ts": 1760000000000 },
    { "slotId": "SLOT-8217", "patient": "+15557000001", "channel": "voice", "status": "attempted", "detail": "missed-patient recovery call",              "ts": 1760000000001 },
    { "slotId": "SLOT-8217", "patient": "+15557000001", "channel": "sms",   "status": "declined",  "detail": "missed patient declined",                    "ts": 1760000000100 },
    { "slotId": "SLOT-8217", "patient": "+15557000003", "channel": "voice", "status": "attempted", "detail": "waitlist offer (priority 1)",                "ts": 1760000000110 },
    { "slotId": "SLOT-8217", "patient": "+15557000003", "channel": "sms",   "status": "confirmed", "detail": "first confirmation wins (sms)",              "ts": 1760000000200 }
  ],
  "confirmation": { "slotId": "SLOT-8217", "patient": "+15557000003", "confirmedAt": 1760000000200, "source": "sms" }
}
```

| `status` | Meaning |
|---|---|
| `attempted` | Outbound dial or SMS sent |
| `answered` | Call answered |
| `no_answer` | Call ended without a decision |
| `timeout` | Reply window elapsed without a reply |
| `declined` | Candidate passed |
| `rescheduled` | Missed patient rebooked |
| `confirmed` | Candidate confirmed (first confirmation wins) |
| `given_up` | Retry budget exhausted / waitlist exhausted |
| `closed` | Lifecycle note (slot opened / expired) |

---

## Per-actor SQL schema (Agent SDK, `this.ctx.storage.sql`)

```sql
CREATE TABLE IF NOT EXISTS outreach_attempts (
  slot_id TEXT NOT NULL,
  patient TEXT NOT NULL,
  channel TEXT NOT NULL,      -- 'voice' | 'sms'
  status  TEXT NOT NULL,      -- see ledger statuses above
  detail  TEXT NOT NULL DEFAULT '',
  ts      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS confirmations (
  slot_id      TEXT PRIMARY KEY,  -- one confirmed patient max per slot
  patient      TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  source       TEXT NOT NULL      -- 'voice' | 'sms'
);
```

`confirmations.slot_id` being a PRIMARY KEY is the durable double-booking
guard: only the first confirmation ever lands, and the actor re-checks it
before every claim.
