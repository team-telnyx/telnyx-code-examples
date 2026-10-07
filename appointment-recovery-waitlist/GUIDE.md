# GUIDE — Missed Appointment Recovery + Waitlist Filler

A walkthrough of the demo: open a slot with a mock scheduling webhook, watch
the durable `AppointmentSlot` actor recover the missed patient, then work the
waitlist in priority order until the first confirmation wins — including the
restart proof that shows why the actor model matters.

All patient data is synthetic (`+1555…` numbers, sample names). No PHI, no
clinical advice.

---

## 1. The concept

When a patient cancels or misses an appointment, the scheduling system fires a
webhook. The Edge function resolves `env.SLOTS.idFromName(slotId)` and **one
durable actor is born for that slot**. The actor owns everything about the
recovery:

- the missed patient (contacted first: reschedule / later / decline),
- the waitlist, in priority order (1 fills first),
- the current candidate, its outreach channel, and its retry budget,
- the reply window (sweep timer) and the slot expiry,
- the confirmation lock — the first patient to confirm wins, everyone else
  gets "slot already taken", and no further outreach ever fires.

Because the actor owns the scarce resource (the slot), double-booking is
structurally impossible: the confirmation is a single row in per-actor SQL
(`confirmations.slot_id` is a PRIMARY KEY), and the actor serializes every
reply and call event.

## 2. Prerequisites

- Node.js 18+ and npm
- `TELNYX_API_KEY` (demo mode needs no live numbers — outbound calls/SMS are
  logged, and replies are driven via the `/demo/*` endpoints)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/appointment-recovery-waitlist
npm install
npm test        # typecheck + the full state-machine smoke suite
```

## 3. Run the demo locally

The sample is an Edge function. The fastest local loop is `telnyx-edge dev`
(or deploy with `telnyx-edge ship`), but every step below is plain `curl`
against the deployed/local URL:

```bash
export BASE=https://<your-function>.telnyxcompute.com   # or http://localhost:8787
```

### Step 1 — Open the slot (actor is born)

```bash
curl -X POST $BASE/webhook/scheduling \
  -H "Content-Type: application/json" \
  -d '{
    "slotId": "SLOT-8217",
    "provider": "Dr. Okafor",
    "startsAt": "2026-10-08T10:00:00",
    "missedPatient": { "name": "Alex Rivera", "phone": "+15557000001" },
    "waitlist": [
      { "name": "Casey Doyle",  "phone": "+15557000003", "priority": 1 },
      { "name": "Brooke Chen",  "phone": "+15557000002", "priority": 2 },
      { "name": "Devin Shah",   "phone": "+15557000004", "priority": 3 }
    ]
  }'
```

What happens inside the actor:

1. state is initialized (slotId, provider, startsAt, missed patient, sorted
   waitlist, cursor = -1),
2. a ledger row is appended to `outreach_attempts`,
3. the expiry timer is scheduled (`SLOT_EXPIRY_MIN`, default 60 min),
4. the missed patient is dialed (`POST /v2/calls` in live mode; logged in
   demo) and a sweep timer is scheduled for the reply window
   (`WAITLIST_REPLY_TIMEOUT_MIN`, default 10 min).

### Step 2 — The missed patient reschedules

```bash
curl -X POST $BASE/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000001", "text": "RESCHEDULE please" }'
```

→ `"decision": "reschedule"`. The actor records the outcome, texts the
patient, and closes the recovery workflow — **the waitlist is never touched**.

### Step 2b — Or the missed patient declines

```bash
curl -X POST $BASE/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000001", "text": "no, can'\''t make it" }'
```

→ `"decision": "decline"`. The slot stays open, so the actor starts the
waitlist fill and dials **Casey Doyle (priority 1)** — not Brooke. Verify:

```bash
curl $BASE/state/SLOT-8217
# { "status": "offering", "cursor": 0, "currentCandidate": { "name": "Casey Doyle", ... } }
```

### Step 3 — First confirmation wins

```bash
curl -X POST $BASE/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000003", "text": "YES" }'
```

→ Casey confirms by SMS. The actor:

1. inserts the confirmation row (the durable lock),
2. bumps the generation — every in-flight sweep/retry timer now no-ops,
3. sends the confirmation SMS ("Reply CANCEL to release"),
4. stops all further outreach.

Now prove the lock: a later patient confirming gets rejected.

```bash
curl -X POST $BASE/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000002", "text": "YES" }'
# → "Sorry — the Dr. Okafor slot at 2026-10-08T10:00:00 was just filled. ..."
```

### Step 4 — No reply? Retry, then move down the waitlist

If a candidate never replies, the sweep timer fires when the reply window
elapses: the actor retries the same patient (alternating voice ↔ SMS) until
`OUTREACH_RETRY_MAX` is spent, then advances the cursor to the next waitlist
patient. You can simulate the timer by re-opening a slot and simply waiting
through the demo steps — or call the sweep directly in a test. The state
machine is identical either way.

### Step 5 — Read the ledger

```bash
curl $BASE/ledger/SLOT-8217
```

Every attempt, response, timeout, and the final outcome is in the
append-only ledger:

```
slot opened → missed call attempted → declined
            → waitlist offer (priority 1) attempted → confirmed (first wins)
```

## 4. The restart proof

The headline feature: **kill the actor mid-outreach and it resumes exactly
where it left off — and never double-books.**

The smoke test (`npm test`) runs this against the real agent code with a
mock durable host:

1. A slot opens; the missed patient declines; the actor offers Casey
   (cursor = 0). Ledger rows exist.
2. **Kill**: the actor instance is dropped.
3. **Rebuild**: a fresh instance is constructed over the same durable store.
   `GET /state` shows the same cursor (0), same status, same ledger.
4. The resumed actor takes Casey's "YES" and fills the slot.
5. A late "YES" from Brooke is rejected — the confirmation lock (a
   `confirmations` row keyed by `slot_id`, plus actor state) held across the
   restart.

On a real deployment the same properties hold because the state lives in
per-actor storage + SQL, and `this.schedule(...)` timers re-arm from durable
tasks on wake.

## 5. Go live

1. Register the secrets (see the Agent / CLI access block in README):
   `DEMO_MODE=false`, `OUTBOUND_CONNECTION_ID`, `OUTBOUND_CALLER_ID`,
   `SCHEDULING_SMS_E164`, `TELNYX_PUBLIC_KEY`, and (optionally) tune the
   timing knobs.
2. Point your messaging profile's `message.received` webhook at
   `/webhook/inbound-message` and your Call Control app's webhook at
   `/webhook/call-events`.
3. `telnyx-edge ship`.

In live mode, calls carry `client_state` (base64 slot id) so every Call
Control event routes back to the owning slot actor; inbound SMS falls back to
the shared `SlotIndex` actor when the reply text has no slot reference.
