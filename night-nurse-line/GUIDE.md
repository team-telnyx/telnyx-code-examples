# Night Nurse Line — a durable after-hours triage chat

A walkthrough of `night-nurse-line`, a Telnyx Edge sample that turns a stateless AI Assistant into a **persistent overnight triage line**. One durable actor per patient keeps the chart — symptoms, meds, allergies, the page-once guard — alive across visits, pod kills, and days. The assistant answers; the actor remembers.

This guide explains every moving part of `src/index.ts` by feature, shows you how to run the demo end-to-end in safe demo mode, and tells you exactly what changes when you flip to live mode.

---

## 1. What you're building

The clinic website embeds a chat. A patient types *"chest tightness since dinner, 32 weeks pregnant"* at 11pm. Three things happen:

1. The **Assistant Chat API** produces a reply that ends with a machine-readable verdict line: `TRIAGE: page-on-call`.
2. The **`NightNurse` actor** (keyed by the patient handle `maya-481`) strips that line, records the symptom in its SQL chart, and — because the verdict is `page-on-call` and it has not paged yet — schedules an SMS to the on-call clinician.
3. The patient sees a clean answer. The clinician gets a page. The chart remembers.

Wednesday morning the same patient asks a follow-up. The actor is re-woken with the full chart and the same `conversation_id`, so the assistant continues the conversation instead of re-triaging from scratch. No second page fires — `state.pageSent` is durable.

That's the whole sample: **the assistant is stateless, the actor is load-bearing.**

---

## 2. Prerequisites

- Node.js 20+
- A Telnyx account with:
  - An **AI Assistant** (created in step 4 below)
  - A **messaging-enabled phone number** (for live mode and for the rota-change webhook)
- The `telnyx-edge` CLI:

```bash
npm install -g telnyx-edge
telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>
```

You do **not** need a Telnyx API key to run the demo in safe demo mode — but the CLI still needs one to deploy the actor.

---

## 3. Project layout

```
night-nurse-line/
├── src/index.ts        # actors + fetch router + helpers (the whole sample)
├── telnyx.toml         # actor, secret, storage, and env bindings
├── package.json
├── tsconfig.json
├── smoke_test.ts
├── .env.example
└── GUIDE.md
```

Everything lives in `src/index.ts`. It exports three actor classes and a default `fetch` handler:

| Export | Role |
| --- | --- |
| `NightNurse` | One durable actor per patient. Owns the chart, the conversation id, the page-once guard. |
| `RotaDesk` | Single actor (`"oncall"`) that owns the current on-call number. |
| `ClinicDesk` | Single actor (`"clinic"`) that aggregates the clinic-wide ledger and sends the daily handoff SMS. |
| `default.fetch` | HTTP router: `/`, `/widget`, `/chat`, `/conversation`, `/sms`, `/report`, `/handoff`. |

---

## 4. Setup

### 4.1 Create the assistant

The actor does not assume an assistant exists. Create one whose instructions end **every** reply with a final line in this exact shape:

```
TRIAGE: <self-care|appointment|page-on-call>
```

A minimal creation call (run once, from your machine):

```bash
curl -sS https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Night Nurse",
    "instructions": "You are an after-hours nurse line. Ask one clarifying question at a time. Never diagnose. End EVERY reply with a final line exactly of the form: TRIAGE: self-care  OR  TRIAGE: appointment  OR  TRIAGE: page-on-call. Use page-on-call for red-flag symptoms (chest pain/tightness, bleeding, shortness of breath, contractions, neuro warning signs)."
  }'
```

Copy the returned assistant `id` — that's your `NIGHT_NURSE_ASSISTANT_ID`.

> **Why the suffix?** The actor needs one unambiguous signal to decide whether to page. Parsing free-text intent is fragile; a trailing sentinel line is not. `splitTriage()` in `src/index.ts` matches `/TRIAGE:\s*(self-care|appointment|page-on-call)\s*$/i`, strips it from the displayed text, and treats a **missing** suffix as `appointment` — the safe default (front-desk follow-up, never a page).

### 4.2 Configure `telnyx.toml`

```toml
name = "night-nurse-line"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "NURSES"
type    = "NightNurse"

[[actors]]
binding = "ROTAS"
type    = "RotaDesk"

[[actors]]
binding = "CLINIC"
type    = "ClinicDesk"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.CLINIC_DB]
id = "<sqldb-namespace-uuid>"

[env_vars]
NIGHT_NURSE_ASSISTANT_ID = "<assistant-id-from-4.1>"
ONCALL_E164              = "+1555XXXXXXX"
DAY_TEAM_E164            = "+1555XXXXXXX"
FROM_E164                = "+1555XXXXXXX"
DEMO_MODE                = "true"
```

### 4.3 Set secrets and deploy

```bash
telnyx-edge secrets add TELNYX_API_KEY    "<your-key>"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<your-webhook-public-key>"
telnyx-edge types          # regenerate telnyx-env.d.ts from telnyx.toml
telnyx-edge ship           # deploy
```

`telnyx-edge types` is what makes `interface Env` in `src/index.ts` line up with the bindings you declared. Run it after every `telnyx.toml` change.

### 4.4 Point the inbound webhook at `/sms`

In the Telnyx portal, set your demo number's **Inbound Message Webhook** to:

```
https://<your-deployment-host>/sms
```

That's the route the clinic manager texts to change the on-call rota.

Use a dedicated demo number for this sample — `+16282210134` is provisioned for it (its messaging profile points here; its voice connection stays untouched, so the `conference-agent-mediator` demo keeps working). Do **not** point the Business Line ACP number (`+15072291272`, shared with the concierge-diary sample) at `/sms` — that number's messaging profile is wired for the ACP demo, and repointing it would pull the night-nurse webhook traffic off the other sample.

---

## 5. Environment variables

| Variable | Where it lives | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | secret | Bearer token for the Assistant Chat API. |
| `TELNYX_PUBLIC_KEY` | secret | Ed25519 public key used to verify inbound SMS webhooks. |
| `NIGHT_NURSE_ASSISTANT_ID` | env var | The assistant created in 4.1. |
| `ONCALL_E164` | env var | **Seed only.** `RotaDesk` copies this into its `rota` row on first boot. After that, the row wins. |
| `DAY_TEAM_E164` | env var | Destination for the daily handoff summary SMS. |
| `FROM_E164` | env var | Sender number. Required in live mode; ignored in demo mode. |
| `DEMO_MODE` | env var | `"true"` (default) logs SMS instead of sending. `"false"` sends for real. |

Bindings (not env vars): `SECRETS`, `NURSES`, `ROTAS`, `CLINIC`, `CLINIC_DB`, `TELNYX`.

---

## 6. Demo mode vs live mode

`isDemo(env)` reads `DEMO_MODE` and defaults to **true**. The switch is enforced in exactly one place — `sendSms()`:

```ts
if (isDemo(env)) {
  console.log(`[demo] SMS to ${maskPhone(to)}: ${text.slice(0, 120)}`);
  return { id: `demo-${Date.now()}`, demo: true };
}
```

**Demo mode (default).** Every outbound SMS — the on-call page, the rota confirmation, the daily handoff — is logged with a masked destination and never sent. No charges, no real numbers dialed. The full state machine still runs: the chart is written, `pageSent` flips, the `pages` ledger row is inserted. You can exercise every acceptance criterion without a single SMS leaving the building.

**Live mode.** Set `DEMO_MODE=false` **and** a valid `FROM_E164`. `sendSms()` then calls `this.env.TELNYX.messages.send({ to, from, text })` through the zero-credential Telnyx binding — the platform injects auth, so no key is ever read in that path. If `FROM_E164` is missing or malformed, `sendSms()` throws rather than silently dropping the page. In the demo environment, set `FROM_E164` to `+16282210134` (the night-nurse demo number — see section 4.4) and text `ONCALL <on-call E.164>` from the clinic manager's phone to seed the rota.

> **Note on webhook verification.** `verifySignature()` also has a demo-mode escape hatch: if `TELNYX_PUBLIC_KEY` is unset and `DEMO_MODE` is true, it logs a warning and accepts the webhook. In live mode, a missing key means every webhook is rejected with 401. Set the key before you flip the switch.

---

## 7. Walkthrough

### 7.1 The durable chart — state plus SQL

`NightNurse` extends `Agent<Env, NurseState>`. `initialState()` returns the per-patient record:

```ts
{ patientId, conversationId, symptoms[], meds[], allergies[],
  redFlag, pageSent, chats, pages, selfCare, lastSeen, lastVerdict }
```

That state is the fast path — the thing that survives a pod kill and re-wakes with the actor. The **long-term** chart lives in SQL, in `CLINIC_DB`, created lazily by `ensureSchema()`:

| Table | Columns | Written by |
| --- | --- | --- |
| `patient_chart` | `patient_id, field, value, updated_at` (PK on `patient_id, field`) | `writeChart()` |
| `sessions` | `id, patient_id, day, verdict, created_at` | `chat()` |
| `pages` | `id, patient_id, day, to_number, summary, created_at` | `pageOnCall()` |
| `rota` | `id=1, number, updated_by, updated_at` | `RotaDesk.setNumber()` |

`patient_chart` is an EAV table: one row per fact, keyed by a namespaced field name. `writeChart()` emits rows like `symptom:chest_tightness`, `med:labetalol`, `allergy:penicillin`, `redflag=1`, `pregnancy_weeks=32`, and upserts them with `ON CONFLICT(patient_id, field) DO UPDATE`. Repeating a symptom updates the timestamp instead of duplicating the row.

`ensureSchema()` memoizes the DDL in a module-level promise so the four `CREATE TABLE IF NOT EXISTS` statements run once per isolate, not once per request.

### 7.2 The chat path

`POST /chat` → `handleChat()` → `env.NURSES.idFromName(patientId)` → `nurse.chat({ patientId, text, conversationId })`.

`handleChat()` validates the handle against `^[a-z0-9][a-z0-9-]{1,63}$` and the text against a 2000-character cap before it ever touches an actor. Bad input returns 400 without waking anything.

Inside `NightNurse.chat()`:

1. **Resolve identity.** `state.patientId || input.patientId` — the actor's own state wins once it's been born, so a mismatched handle in a later request can't hijack the chart.
2. **Call the assistant.** `assistantChat()` POSTs to `https://api.telnyx.com/v2/ai/assistants/{id}/chat` with `{ content, name: patientId, conversation_id? }`. The `name` field is the stable patient handle — that's how the assistant's server-side history is keyed. `conversation_id` is included only when we already have one.
3. **Parse the verdict.** `splitTriage(reply.content)` returns `{ text, triage }`.
4. **Extract facts.** `extractFacts(input.text)` scans the *patient's* raw message — not the assistant's reply — for red-flag markers, meds, allergies, and pregnancy weeks, then `writeChart()` persists them.
5. **Apply the office-hours rule** (see 7.5).
6. **Page if warranted** (see 7.4).
7. **Record the session** in `sessions` with today's PT date and the verdict.
8. **Persist state** via `setState()` — merge-patch, so only the changed fields are written.

The response is a `ChatResult`: `{ patientId, content, conversationId, triage, pageSent, officeHours, redFlag }`. The relay page uses `content` and `conversationId`; the `triage` field is what drives the `[on-call paged]` line in the UI.

### 7.3 Chart extraction is dual-source, actor-authoritative

`extractFacts()` is deterministic — regex and keyword rules, no model call:

- **Red flags:** `chest tightness|pain|pressure`, `shortness of breath`, `bleeding`, `severe headache|blurred vision`, `contractions`. Each match appends a symptom label and sets `redFlag`.
- **Meds:** `/(?:i'?m taking|taking|started|prescribed)\s+([a-z][a-z0-9-]{2,}...)/gi`
- **Allergies:** `/allergic to ([a-z][a-z0-9\s-]{2,30})/gi`
- **Pregnancy:** `/(\d{1,2})\s*weeks?\s+pregnan/i`

The assistant *may* also append a `CHART: {...}` block to its reply — if it does, you can extend `splitTriage()` to parse and strip it. If it doesn't, text extraction alone is authoritative. **Missing chart data never blocks the chat flow** — the reply goes out regardless.

Critically: the keyword scan is **advisory only**. It annotates the chart (`redflag=1`) and ORs into `state.redFlag`, but it does **not** trigger a page. Only the `TRIAGE` verdict does. This is the single-signal rule — if the keyword scan fires but the assistant says `self-care`, the assistant wins and no page happens.

### 7.4 The page-once guard

```ts
const redFlag = parsed.triage === "page-on-call";
let pageSent = state.pageSent;
if (redFlag && !state.pageSent) {
  pageSent = true;
  await this.schedule(0, "pageOnCall", { patientId, summary: buildPageSummary(...) });
}
```

Two things matter here:

1. **`pageSent` is set to `true` synchronously in the same turn**, before the scheduled task runs. If the pod dies between the `setState()` and the SMS, the next message re-wakes the actor with `pageSent: true` and no second page fires. That's the durability requirement.
2. **The page is a scheduled task, not an inline await.** `this.schedule(0, "pageOnCall", payload)` enqueues the handler on the Agent SDK's scheduler with zero delay. The chat response returns immediately; the SMS dispatch happens out-of-band and is itself retried by the runtime.

`pageOnCall()` then:

- Calls `RotaDesk.current()` over RPC to get the **live** on-call number (not the env seed).
- Calls `sendSms()` with `Night Nurse page: <summary>`.
- Inserts a row into `pages` with the destination **masked** (`maskPhone()` → `+15******1234`).
- Increments `state.pages`.

`buildPageSummary()` composes the human-readable page body from the extracted facts: symptoms, pregnancy weeks, meds, allergies. That's what the on-call clinician reads on their lock screen.

### 7.5 Office hours are safety-first

`isOfficeHours()` formats the current time in `America/Los_Angeles` and returns true for Mon–Fri, 09:00–16:59 PT.

The rule in `chat()`:

```ts
const content = officeHours && !redFlag ? FRONT_DESK_REPLY : parsed.text;
```

- **Office hours + routine chat** → the patient gets `"The front desk will follow up with you when the clinic opens at 9am PT."` instead of the assistant's answer. The chart is still updated and the session is still recorded.
- **Office hours + red flag** → the assistant's answer goes through **and the page fires**. A `page-on-call` verdict pages at any hour. Office hours never suppress a red flag.
- **After hours** → the assistant's answer goes through normally.

The daily handoff SMS is unaffected by this rule — it always goes out.

### 7.6 The rota override

`RotaDesk` is a single actor (`env.ROTAS.idFromName("oncall")`) that owns one row in `rota`.

- `current()` reads the row. If it's empty (first boot), it seeds from `ONCALL_E164`, validates it as E.164, writes it via `setNumber()`, and returns it.
- `setNumber({ number, updatedBy })` normalizes the input (`normalizeE164()` handles `+1`, 10-digit, and bare-digit forms), validates against `^\+[1-9]\d{7,14}$`, upserts the row, and calls `replaceState()`.

The clinic manager changes the rota by texting the demo number:

```
ONCALL +15551234567
```

`handleSms()` matches `/^ONCALL\s+(\+?[\d\s().-]{7,20})$/i`, calls `desk.setNumber({ number, updatedBy: maskPhone(from) })`, and returns `{ received: true, rota: "+15******4567" }`. The **next** page reads the new number through `RotaDesk.current()` — no redeploy, no env change.

Any other inbound text is ignored unless it carries a patient handle:

```
PATIENT maya-481 the tightness stopped, do I still see my doctor?
```

That form routes into `nurse.chat()` and texts the reply back to the sender. It's the SMS-side entry point for the same actor.

### 7.7 Webhook verification

`handleSms()` reads the raw body **before** parsing, then calls `verifySignature(req, raw, env)`:

- Pulls `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
- Rejects if the timestamp is more than 300 seconds off (replay window).
- Imports `TELNYX_PUBLIC_KEY` as an Ed25519 key via `crypto.subtle.importKey` and verifies the signature over `` `${timestamp}|${raw}` ``.
- Returns 401 on any failure.

Only after verification does it check `event.data.event_type === "message.received"` and read `event.data.payload.from.phone_number` / `event.data.payload.text`. Non-message events return `200 { received: true, ignored: true }` so Telnyx doesn't retry them.

### 7.8 The morning report

There are **two** reports, and they answer different questions.

**Per-patient — `NightNurse.report(day)`.** Aggregates `sessions` and `pages` for *this* patient on *this* day. Returns `{ patientId, day, chats, pages, selfCare, appointments, pageOnCall }`. Useful for "how many times did Maya chat last night?"

**Clinic-wide — `ClinicDesk.report(day)`.** The same aggregation with no patient filter. This is the number in the demo flow: *3 chats, 1 page, 0 self-care cases*. `GET /report?day=YYYY-MM-DD` hits this one (defaulting to today in PT).

`ClinicDesk.arm()` is idempotent — it calls `this.every(86400, "dailyHandoff")` exactly once, guarded by `state.armed`. `dailyHandoff()` builds today's clinic report and sends one SMS to `DAY_TEAM_E164`:

```
Night Nurse handoff 2026-11-10: 3 chats, 1 pages, 0 self-care.
```

If `DAY_TEAM_E164` isn't a valid E.164 number, it logs a warning and skips the SMS rather than throwing. You can trigger the handoff manually with `POST /handoff` — handy for testing without waiting 24 hours.

### 7.9 Two widget paths, deliberately separate

The sample ships **both** front ends because they demonstrate different integration shapes.

**Path A — pure widget (`GET /widget`).** The page embeds the Telnyx web-chat widget in text-only mode:

```html
<telnyx-ai-agent agent-id="..." text-only data-patient-handle="maya-481"></telnyx-ai-agent>
<script type="module" src="https://esm.sh/@telnyx/ai-agent-widget"></script>
```

The widget opens a server-brokered WebSocket straight to Telnyx — the browser never holds an API key, and the actor **cannot inject into that stream**. The widget renders the assistant's replies natively. The page carries a tiny bridge script so the actor still owns the chart: on `agent.connected` (whose detail carries the `conversationId`) and on every `transcript.item`, it POSTs `{ patientId, conversationId }` to `/conversation`; the actor then reads the completed transcript back via `GET /v2/ai/conversations/{id}/messages`, extracts chart facts from each new patient turn, and runs the same page-once guard — idempotently, keyed by how many messages it has already ingested. The `data-patient-handle` attribute is how the page knows which actor to key.

> The assistant must have `telephony_settings.supports_unauthenticated_web_calls` enabled for the text-only widget to connect — `scripts/setup_assistant.sh` sets it for you.

**Path B — relay (`GET /`).** The page renders its own chat div and POSTs each completed patient turn to `/chat`:

```js
const res = await fetch('/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ patientId: handle, text, conversationId })
});
const data = await res.json();
if (data.conversationId) conversationId = data.conversationId;
```

The actor calls the Assistant Chat API, returns `content`, and the page renders it. `conversationId` is held in a page variable and passed back on every turn — that's how the assistant's server-side history continues. The handle comes from `?patient=maya-481` in the URL.

Path B is the one to use when you need the actor to own the reply text (custom UI, extra annotations, the `[on-call paged]` marker). Path A is the one to use when you want the widget's built-in UI; the actor still sees the whole conversation through the readback ingest, so the chart and the page guard work identically in both paths.

---

## 8. Running the demo flow

Deploy, then walk the ticket's eight steps.

**Step 1–2 — Maya opens the chat at 11pm.**

```bash
curl -sS -X POST https://<host>/chat \
  -H 'content-type: application/json' \
  -d '{"patientId":"maya-481","text":"chest tightness since dinner, 32 weeks pregnant"}'
```

Expect `triage: "page-on-call"`, `pageSent: true`, and a `conversationId` in the response. In demo mode the console logs `[demo] SMS to +15******XXXX: Night Nurse page: maya-481, chest tightness, 32w pregnant`.

**Step 3 — the page.** Already dispatched by the scheduled `pageOnCall` task. Check the `pages` table or the log line.

**Step 4 — the morning report.**

```bash
curl -sS "https://<host>/report?day=2026-11-10"
# {"day":"2026-11-10","chats":3,"pages":1,"selfCare":0,"appointments":2,"pageOnCall":1}
```

**Step 5 — Wednesday follow-up.** Same handle, new text, pass the `conversationId` from step 2:

```bash
curl -sS -X POST https://<host>/chat \
  -H 'content-type: application/json' \
  -d '{"patientId":"maya-481","text":"the tightness stopped, do I still see my doctor?","conversationId":"<id-from-step-2>"}'
```

Expect `pageSent: true` (still true — no second page) and a reply that continues the conversation.

**Step 6 — office hours.** Run the same call between 9am and 5pm PT with a routine message. Expect `content` to be the front-desk line and `officeHours: true`.

**Step 7 — pod kill.** Redeploy (`telnyx-edge ship`) mid-conversation, then send another message with the same handle. The actor re-wakes with `symptoms`, `pageSent: true`, and the existing `conversationId`. No second page.

**Step 8 — rota change.** Text the demo number:

```
ONCALL +15559876543
```

Then trigger another red-flag chat. The page goes to the new number — check the `pages` row's masked `to_number`.

**Daily handoff (manual trigger):**

```bash
curl -sS -X POST https://<host>/handoff
```

---

## 9. Smoke test

`smoke_test.ts` imports the module and asserts it loads without error — the actors and the default export resolve, the pure helpers behave:

```bash
npx tsx smoke_test.ts
```

It's a plain tsx script (no test runner), so it runs anywhere Node 20 runs. It does not hit the network and does not require secrets.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NIGHT_NURSE_ASSISTANT_ID is not configured` | Env var missing or empty | Set it in `telnyx.toml` `[env_vars]`, run `telnyx-edge types`, redeploy. |
| `assistant chat failed with status 401` | `TELNYX_API_KEY` secret missing or wrong | `telnyx-edge secrets add TELNYX_API_KEY "<key>"`. |
| Every reply is `appointment` | Assistant instructions don't end with the `TRIAGE:` line | Recreate or update the assistant per §4.1. |
| No page ever fires | Verdict is never `page-on-call`, or `pageSent` is already true | Check the raw assistant reply; check `state.pageSent` via a fresh chat response. |
| `destination must be an E.164 number` | `RotaDesk` seeded from a malformed `ONCALL_E164` | Fix the env var, or send `ONCALL +1...` to overwrite the row. |
| `FROM_E164 must be an E.164 number in live mode` | `DEMO_MODE=false` without a sender | Set `FROM_E164` or flip back to demo. |
| Webhook returns 401 | `TELNYX_PUBLIC_KEY` unset in live mode, or clock skew > 300s | Set the secret; check the host clock. |
| `invalid patient handle` | Handle doesn't match `^[a-z0-9][a-z0-9-]{1,63}$` | Lowercase it; no underscores, no spaces. |
| Widget page shows nothing | `NIGHT_NURSE_ASSISTANT_ID` fails the `^[A-Za-z0-9_-]{1,64}$` check | `/widget` returns 500 with a clear error — fix the env var. |

---

## 11. Next steps

- **Assistant Chat API** — streaming (`stream: true`), SSE event shapes, and the full request/response schema: <https://developers.telnyx.com/api-reference/assistants/assistant-chat>
- **Web chat without voice** — the widget embed, `text-only` mode, and the `agent-id` attribute: <https://developers.telnyx.com/docs/inference/ai-assistants/web-chat>
- **Get conversation messages** — the Path A transcript readback: <https://developers.telnyx.com/api-reference/conversations/get-conversation-messages>
- **Create a conversation** — pre-provisioning a `conversation_id` before the first turn: <https://developers.telnyx.com/api-reference/conversations/create-a-conversation>
- **Agent SDK** — `Agent`, `schedule`, `every`, `setState`, RPC surfaces, and SQL bindings: <https://developers.telnyx.com/docs/agent-sdk>
- **Messages API** — the SMS surface behind the page and the rota override: <https://developers.telnyx.com/docs/messaging/messages>

### Ideas to extend

- Add a `GET /chart?patient=<handle>` route that reads `patient_chart` directly for a clinician-facing view.
- Replace the regex `extractFacts()` with a second assistant call that returns structured JSON — keep the regex as the fallback so the chat never blocks.
- Wire `ClinicDesk.dailyHandoff()` to a real 9am PT cron by adjusting the `every(86400, ...)` interval and gating on `isOfficeHours()`.
- Add a `pageAck` inbound command (`ACK <patient>`) that flips a `pageAcked` row so the morning report can show response time.
- Swap the relay page's plain `<pre>` for a real chat UI and keep the same `POST /chat` contract — the actor doesn't care what renders the text.
