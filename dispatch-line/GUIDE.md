# The Dispatch Line — a shift log that writes itself mid-call

A walkthrough of the `dispatch-line` sample: one durable Telnyx Edge actor per shift that rides **in-call transcription**, files every job the foreman speaks into a SQL `shift_log` table, and reads the confirmation back over the same leg — before the call is over.

This guide explains how the code works, how to run it, and how to switch between safe demo mode and live mode.

---

## 1. What you are building

The actor **is** the shift log. Not a transcription dump, not a recording archive — a durable entity that represents one shift on one dispatch line.

```
Thursday 07:00  call arrives  → answer → transcription_start → actor born (shift-2026-11-19)
Thursday 07:02  "swap the actuator on north yard door 3"
                → call.transcription webhook → parse → INSERT shift_log row (status: open)
Thursday 07:03  → speak on the same leg: "North yard, door 3, actuator swap — logged."
Thursday 07:10  call.hangup → transcription_stop → tally
Thursday 11:40  dispatcher asks tally() → { open: 6, closed: 2 } straight from SQL
Thursday 15:00  second call: "that actuator from this morning — the order came in"
                → keyword match → new row linked to the morning's open job
```

The signature moment: **the office hears "logged" while the truck is still rolling.**

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | The sample targets ES2022 modules |
| A Telnyx account | [portal.telnyx.com](https://portal.telnyx.com) |
| A Telnyx API key | Portal → API Keys → Create |
| A Telnyx **public key** | Portal → API Keys → Public Key (used for Ed25519 webhook verification) |
| A voice-capable phone number | Assigned to a Call Control application |
| `telnyx-edge` CLI | `npm i -g telnyx-edge` (or use `npx telnyx-edge`) |
| A public HTTPS URL for webhooks | The Edge deployment URL works; use ngrok for local iteration |

You do **not** need a transcription add-on configured separately — in-call transcription is started per-leg with the Call Control command shown below.

---

## 3. Project layout

```
dispatch-line/
├── src/
│   └── index.ts          # actor, webhook handler, tally route, Telnyx REST surface
├── telnyx.toml           # actor binding, SQL binding, secrets
├── package.json          # @telnyx/edge-runtime ^0.15.1, deploy/types scripts
├── tsconfig.json
├── smoke_test.ts         # imports the module, asserts the pure helpers behave
├── .env.example
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md              # this file
```

Everything that runs lives in `src/index.ts`. It has three layers:

1. **Pure helpers** — job parsing, confirmation phrasing, keyword extraction, sequence derivation. No I/O, trivially testable.
2. **`DispatchLine` actor** — the durable shift log. Owns state, SQL, and the Telnyx calls.
3. **Fetch handler** — verifies webhooks, routes `call.initiated` / `call.answered` / `call.transcription` / `call.hangup` into the actor, and exposes `GET /tally`.

---

## 4. Environment setup

### 4.1 `.env.example`

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
DEMO_MODE=true
```

Copy it and fill in real values for live mode:

```bash
cp .env.example .env
```

### 4.2 Secrets on the Edge platform

The actor reads credentials through the `SECRETS` binding, never from `process.env`:

```bash
telnyx-edge auth api-key set $TELNYX_API_KEY
telnyx-edge secrets add TELNYX_API_KEY "KEY..."
telnyx-edge secrets add TELNYX_PUBLIC_KEY "BASE64_PUBLIC_KEY..."
```

`TELNYX_PUBLIC_KEY` is the **base64** Ed25519 public key from the portal (not PEM). The code wraps it in a DER/SPKI prefix before importing it into WebCrypto — see §6.4.

### 4.3 `telnyx.toml` bindings

```toml
name = "dispatch-line"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "DISPATCH"        # env.DISPATCH.idFromName("shift-2026-11-19")
type    = "DispatchLine"

[storage.sqldb.SHIFT_DB]    # env.SHIFT_DB — the shift_log table lives here
id = "<sqldb-namespace-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

# Actor projects do not get [env_vars] injected — ship config as secrets:
[[secrets]]
binding = "DEMO_MODE"
name    = "DEMO_MODE"
# ... then set the value once: telnyx-edge secrets add DEMO_MODE true
```

After editing bindings, regenerate the ambient types so `interface Env` lines up with reality:

```bash
telnyx-edge types      # writes telnyx-env.d.ts
```

### 4.4 Demo mode vs live mode

| | Demo mode (`DEMO_MODE=true`, the default) | Live mode (`DEMO_MODE=false`) |
|---|---|---|
| Outbound Telnyx calls | Logged to stdout, return `"demo"` | Real `POST https://api.telnyx.com/v2/...` |
| API key required | No | Yes (`TELNYX_API_KEY` secret) |
| Webhook signature | Skipped with a warning if `TELNYX_PUBLIC_KEY` is unset | Enforced; unsigned requests get `401` |
| Cost | Zero | Real call + transcription charges |

The switch is a single function in `src/index.ts`:

```ts
function demoMode(env: Env): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}
```

Every outbound Telnyx request funnels through `telnyxPost()`, which short-circuits in demo mode. That means you can replay the entire demo flow — answer, transcription_start, speak, transcription_stop — with `curl` and see exactly which API calls *would* fire, without spending a cent.

To go live: register the config as a **secret** (the Edge runtime does not inject `[env_vars]` for actor projects), add both secrets, and `telnyx-edge ship`:

```bash
telnyx-edge secrets add DEMO_MODE false
```

---

## 5. Running it

```bash
# 1. install
npm install

# 2. regenerate env types from telnyx.toml
npm run types

# 3. typecheck + smoke test
npx tsc --noEmit
npx tsx smoke_test.ts

# 4. deploy
npm run deploy          # → telnyx-edge ship
```

Point your Call Control application's webhook URL at:

```
https://<your-edge-deployment>/webhooks/telnyx
```

Then drive the demo:

```bash
# simulate the first call of the shift
curl -X POST https://<your-edge-deployment>/webhooks/telnyx \
  -H 'content-type: application/json' \
  -H 'telnyx-signature-ed25519: <sig>' \
  -H 'telnyx-timestamp: <ts>' \
  -d '{"data":{"id":"evt_1","event_type":"call.initiated","occurred_at":"2026-11-19T07:00:00Z",
       "payload":{"call_control_id":"v3:abc"}}}'

# simulate the foreman speaking a job line
curl -X POST https://<your-edge-deployment>/webhooks/telnyx \
  -H 'content-type: application/json' \
  -d '{"data":{"id":"evt_2","event_type":"call.transcription","occurred_at":"2026-11-19T07:02:00Z",
       "payload":{"call_control_id":"v3:abc",
                  "transcript":"swap the actuator on north yard door 3",
                  "transcription_data":{"is_final":true,"sequence":2}}}}'

# ask for the shift tally
curl 'https://<your-edge-deployment>/tally?shift=shift-2026-11-19'
```

In demo mode the second request logs:

```
[dispatch-line][demo] POST /v2/calls/v3%3Aabc/actions/speak {"payload":"North yard, door 3, actuator swap — logged.","payload_type":"text","voice":"female","language":"en-US"}
```

and the tally route answers:

```json
{
  "ok": true,
  "shiftId": "shift-2026-11-19",
  "tally": { "shiftId": "shift-2026-11-19", "open": 1, "closed": 0, "linked": 0, "total": 1 },
  "rpcSurface": ["tally", "onCallStart", "onTranscription", "onCallHangup", "onJobReference"]
}
```

---

## 6. How the code works

### 6.1 Types and the actor's state shape

At the top of `src/index.ts` you'll find the sample's own types — `Env`, `ShiftState`, `TranscriptionSegment`, `ParsedJob`, `JobRow`, `Tally`. These are declared locally; the runtime types (`Agent`, `Secrets`, `ActorNamespace`, `SqlDatabase`) are **imported** from `@telnyx/edge-runtime` and never re-declared.

`ShiftState` is the actor's durable, merge-patched state:

```ts
interface ShiftState {
  shiftId: string;
  openJobs: number;
  closedJobs: number;
  linkedJobs: number;
  lastSeq: number;
  activeCalls: string[];   // legs currently streaming transcription
}
```

`activeCalls` is what makes `transcription_stop` safe: if a hangup arrives for a leg the actor never saw start (or already stopped), the stop call is skipped instead of firing at a dead call.

### 6.2 Job extraction — `parseJob`, `objectAfterVerb`, `confirmationLine`

The parser is deliberately small and deterministic. `parseJob(text)` returns `null` unless the sentence contains **both**:

* a job verb — `swap | replace | install | repair | fix | service | inspect | deliver | adjust | rebuild | order` (`JOB_VERB`)
* a location — a site phrase like `north yard` / `rear dock` (`SITE_WORD`) **or** a door reference like `door 3` (`DOOR_WORD`)

That double gate is what keeps ordinary conversation out of the shift log. "Hey, how's it going" has no verb and no site; "swap the actuator on north yard door 3" has both.

`objectAfterVerb()` grabs the noun phrase between the verb and the next preposition (`on`, `at`, `in`, `for`, `from`) or punctuation, so `swap the actuator on north yard door 3` yields `actuator swap`.

`confirmationLine()` turns the parsed job into the spoken read-back:

```
site:    "north yard door 3"  →  "North yard, door 3"
jobText: "actuator swap"
line:    "North yard, door 3, actuator swap — logged."
```

That exact string is what goes out over `POST /v2/calls/{id}/actions/speak`.

### 6.3 Sequence derivation and idempotency — `segmentSeq`, `fnv1a`, `shiftIdFor`, `toSegment`

Telnyx may redeliver a webhook. The shift log must not grow a duplicate row when it does. The sample solves this by deriving a **stable** `seq` per segment:

1. If `transcription_data.sequence` (or a top-level `sequence`) carries a finite number, use it.
2. Otherwise, FNV-1a hash the webhook event id — the Voice API `call.transcription` callback carries no sequence field, so this is the usual path — falling back to `call_control_id|transcript` if the id is missing.

Either way, the same webhook delivered twice resolves to the same `seq`, and `insertRow()` is a no-op the second time.

`shiftIdFor(occurredAt)` derives the actor name from the event's date: `shift-2026-11-19`. Every webhook for that calendar day routes to the same actor instance — that's the whole point. `toSegment()` normalises the two payload shapes the docs show (`payload.transcript` and `payload.transcription_data.transcript`) into one `TranscriptionSegment`, and treats `is_final` as `true` unless explicitly `false`.

### 6.4 Webhook verification — `verifySignature`

Telnyx signs webhooks with Ed25519 over the string `` `${timestamp}|${rawBody}` ``. The handler:

1. Reads `TELNYX_PUBLIC_KEY` from the `SECRETS` binding.
2. Rebuilds a DER/SPKI key by prefixing the raw base64 key with `ED25519_SPKI_PREFIX` (`30 2a 30 05 06 03 2b 65 70 03 21 00`).
3. Imports it with `crypto.subtle.importKey("spki", ..., { name: "Ed25519" }, ...)`.
4. Verifies against `telnyx-signature-ed25519` over `timestamp|raw`.

The handler also enforces a **freshness window**: a `telnyx-timestamp` more than
±5 minutes from the server clock is rejected as a replay, so a captured webhook
cannot be re-posted hours later with its signature intact.

If the public key is missing, demo mode logs a warning and continues; live mode returns `401`. Any verification exception is logged and treated as a failure — never as a pass.

### 6.5 The Telnyx REST surface — `telnyxPost`

One helper, used by both the fetch handler and the actor:

```ts
async function telnyxPost(env: Env, path: string, body: unknown): Promise<string>
```

* Demo mode → `console.log("[dispatch-line][demo] POST /v2" + path + ...)`, return `"demo"`.
* Live mode → `fetch("https://api.telnyx.com/v2" + path)` with `Authorization: Bearer <TELNYX_API_KEY>`, return `"ok"` or `"error:<status>"`.

Failures log a truncated response body (200 chars) and return a status string rather than throwing, so a failed `speak` never rolls back a job row that was already filed.

### 6.6 The `DispatchLine` actor

```ts
export class DispatchLine extends Agent<Env, ShiftState> { ... }
```

`Agent` gives the class `getState()` / `setState()` (merge-patch) and durable `this.ctx.storage`. Methods are dispatchable over the agent socket only when decorated with `@rpc()` — every public surface on `DispatchLine` (`tally`, `onCallStart`, `onTranscription`, `confirmOverCall`, `onCallHangup`, `onJobReference`, `shiftState`) carries the decorator; the private `ensureSchema()` / `insertRow()` helpers deliberately do not. `rpcSurface()` (used by the `/tally` route) introspects exactly that decorated set.

**`initialState()`** — zeroed counters, empty `activeCalls`.

**`onCallStart(callId, shiftId, greet?)`** — the birth of the day's actor. Ensures the schema, adds the leg to `activeCalls`, then fires the current Call Control transcription body:

```
POST /v2/calls/{call_control_id}/actions/transcription_start
{
  "transcription_engine": "Telnyx",
  "transcription_engine_config": {
    "transcription_engine": "Telnyx",
    "language": "en",
    "transcription_model": "openai/whisper-large-v3-turbo"
  }
}
```

This is the in-call transcription primitive: no media download, no post-call batch — segments start arriving on `call.transcription` as the conversation happens.

When `greet` is true — set only on `call.answered`, which fires exactly once per leg in either direction — the actor also speaks the one-shot prompt *"Dispatch line. Go ahead with your job."* so the foreman knows when to talk. Transcription is armed *before* the prompt so nothing said in response is missed.

**`onTranscription(segment)`** — the heart of the sample:

1. `ensureSchema()` (idempotent `CREATE TABLE IF NOT EXISTS`).
2. Drop non-final or empty segments.
3. Persist the raw segment to durable storage under `transcript:<seq>` — every final segment lands in the actor's history exactly once, so each transcription webhook yields one durable entry — but the *log* is what it acts on.
4. Try `onJobReference()` first: a reference note ("that actuator from this morning — the order came in") attaches to an earlier job before it can be mis-parsed as a new one.
5. `parseJob(text)` → if it's a job, build a `JobRow` with `status: "open"` and `insertRow()` it.
6. On a successful insert, bump `openJobs` and `lastSeq`, then `confirmOverCall()`.

**`confirmOverCall(callId, job)`** — speaks the read-back on the live leg:

```
POST /v2/calls/{call_control_id}/actions/speak
{ "payload": "North yard, door 3, actuator swap — logged.",
  "payload_type": "text", "voice": "female", "language": "en-US" }
```

**`onCallHangup(callId)`** — if the leg is in `activeCalls`, fire `transcription_stop` and remove it; otherwise return `"skipped"`. Then return the current tally. No orphaned transcript sessions.

**`onJobReference(text, callId, seq)`** — cross-call memory. Requires a reference cue (`that`, `same`, `earlier`, `this morning`, `before`, `yesterday`, `the one`, plus completion cues like `done`), then queries open rows for the shift and matches on keywords (`keywordsOf()` strips stopwords and short tokens). A hit inserts a new row with `status: "linked"` and increments `linkedJobs`. That's how "that actuator from this morning — the order came in" attaches to the 07:02 job without re-parsing it as a new one. If the note carries a **completion cue** (`done`, `finished`, `complete`, `all set`, `wrapped`, `closed`), the linked job is updated to `status: 'closed'` — `openJobs` decrements, `closedJobs` increments — so the dispatcher's tally closes itself from the second call, no follow-up needed. The insert happens *before* the update, so a replayed note can never re-close an already-closed job.

**`tally()`** — the dispatcher surface. One `GROUP BY status` query:

```sql
SELECT status, COUNT(*) AS count FROM shift_log WHERE shift_id = ? GROUP BY status
```

Returns `{ shiftId, open, closed, linked, total }`. Counts come straight from SQL — not from replaying a transcript.

### 6.7 The `shift_log` schema

Created by `ensureSchema()` and written only by `insertRow()`:

```sql
CREATE TABLE IF NOT EXISTS shift_log (
  shift_id       TEXT        NOT NULL,
  seq            INTEGER     NOT NULL,
  job_text       TEXT        NOT NULL,
  site           TEXT,
  status         TEXT        NOT NULL CHECK (status IN ('open','closed','linked')),
  created_at     TIMESTAMPTZ NOT NULL,
  source_call_id TEXT,
  PRIMARY KEY (shift_id, seq)
)
```

| Column | Meaning |
|---|---|
| `shift_id` | `shift-YYYY-MM-DD` — the actor's identity, and the partition key for every query |
| `seq` | Deterministic segment sequence; the idempotency key |
| `job_text` | The parsed job phrase (`actuator swap`) or, for linked rows, the raw reference text |
| `site` | `north yard door 3` |
| `status` | `open` → filed and awaiting completion; `closed` → done; `linked` → a later note attached to an earlier job |
| `created_at` | ISO timestamp of the insert |
| `source_call_id` | Which leg produced the row — the audit trail across calls |

`insertRow()` does a `SELECT seq` pre-check and then the `INSERT`. The composite primary key is the real guarantee: even if two webhooks race, the second insert cannot duplicate `(shift_id, seq)`.

### 6.8 Actor birth — `dispatchLine(env, shiftId)`

```ts
export function dispatchLine(env: Env, shiftId: string): DispatchLine {
  const id = env.DISPATCH.idFromName(shiftId);
  return env.DISPATCH.get(id) as unknown as DispatchLine;
}
```

`idFromName("shift-2026-11-19")` is deterministic: every request for that shift — the 07:00 call, the 11:40 tally, the 15:00 callback — lands on the **same** actor instance with the same state and the same SQL rows. That's the "no context reconstruction" property in the acceptance criteria.

### 6.9 The fetch handler

`handleWebhook()` reads the raw body **first** (signature verification needs the exact bytes), verifies, parses, and routes on `data.event_type`:

| Event | Action |
|---|---|
| `call.initiated` | Inbound: `POST /v2/calls/{id}/actions/answer`; outbound: skip answer (callee answers) — then `line.onCallStart(callId, shiftId)` |
| `call.answered` | `line.onCallStart(callId, shiftId, greet: true)` — re-arms transcription and speaks the one-shot prompt |
| `call.transcription` | `toSegment(...)` → `line.onTranscription(segment)` |
| `call.hangup` | `line.onCallHangup(callId)` |
| anything else | `{ ok: true, ignored: <type> }` |

`handleTally()` serves `GET /tally?shift=shift-YYYY-MM-DD`, validates the shift id against `/^shift-\d{4}-\d{2}-\d{2}$/`, calls `line.tally()`, and includes `rpcSurface: rpcSurfaceNames()` in the response.

`rpcSurfaceNames()` uses `rpcSurface()` from the runtime to enumerate the actor's callable methods, falling back to a static list if the helper isn't available in your runtime version. That's how the demo proves `tally()` is a real RPC surface and not a REST shim.

---

## 7. The demo flow, mapped to code

| Step | What happens | Where |
|---|---|---|
| 1 | 07:00 — call arrives, answered, transcription started, actor born | `handleWebhook` → `onCallStart` |
| 2 | 07:02 — "swap the actuator on north yard door 3" → one row filed | `onTranscription` → `parseJob` → `insertRow` |
| 3 | 07:03 — "North yard, door 3, actuator swap — logged." spoken on the leg | `confirmOverCall` |
| 4 | 07:10 — hangup → `transcription_stop` → tally | `onCallHangup` |
| 5 | 11:40 — dispatcher asks `tally()` → 6 open, 2 closed | `tally` |
| 6 | 15:00 — "that actuator from this morning" links to the 07:02 row | `onJobReference` |
| 7 | Pod killed after step 2 → next segment re-wakes the actor → row set unchanged | `insertRow` idempotency on `(shift_id, seq)` |

Step 7 is the durability proof: the actor's state and the SQL rows survive a restart, and a redelivered webhook resolves to the same `seq`, so the pre-check returns early and nothing duplicates.

---

## 8. Testing

`smoke_test.ts` imports the module and exercises the pure helpers — no network, no credentials:

```bash
npx tsx smoke_test.ts
```

It asserts:

* `parseJob("swap the actuator on north yard door 3")` → `{ jobText: "actuator swap", site: "north yard door 3" }`
* `parseJob("hey how's it going")` → `null`
* `confirmationLine(...)` → `"North yard, door 3, actuator swap — logged."`
* `segmentSeq(payload, "evt_2")` is stable across two calls with the same event id
* `shiftIdFor("2026-11-19T07:00:00Z")` → `"shift-2026-11-19"`

Because the helpers are pure, the test runs in milliseconds and gates the PR before any deploy.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 invalid_signature` | Public key missing, wrong encoding, or body was parsed before verification | Set `TELNYX_PUBLIC_KEY` to the **base64** key; read `request.text()` before `JSON.parse` |
| No `call.transcription` events | `transcription_start` never fired, or the Call Control app's webhook URL is wrong | Check the `call.initiated` response body for `transcription: "ok"`; confirm the webhook URL |
| Job spoken but no row | Sentence lacked a verb or a site/door | `parseJob` requires both — check the transcript text in the response |
| Duplicate rows | `seq` differs between deliveries | Confirm `transcription_data.sequence` is present; otherwise the FNV-1a hash of the event id must be stable |
| `transcription_stop` returns `skipped` | Leg was never in `activeCalls` (e.g. hangup arrived before `call.initiated` was processed) | Expected — the guard prevents calling a dead leg |
| Tally always zero | Querying a different `shift` than the events' `occurred_at` date | Pass `?shift=shift-YYYY-MM-DD` matching the event date |
| `TELNYX_API_KEY is not configured` | Live mode without the secret | `telnyx-edge secrets add TELNYX_API_KEY "..."` or set the `DEMO_MODE` secret to `true` |

---

## 10. Next steps

* **In-call transcription docs** — [Speech-to-Text with Voice API and TeXML](https://developers.telnyx.com/docs/voice/programmable-voice/speech-to-text)
* **Start transcription** — [`POST /v2/calls/{call_control_id}/actions/transcription_start`](https://developers.telnyx.com/api-reference/call-commands/transcription-start)
* **Stop transcription** — [`POST /v2/calls/{call_control_id}/actions/transcription_stop`](https://developers.telnyx.com/api-reference/call-commands/transcription-stop)
* **The `call.transcription` callback** — [Transcription callback reference](https://developers.telnyx.com/api-reference/callbacks/transcription)
* **Speak on a live leg** — [`POST /v2/calls/{call_control_id}/actions/speak`](https://developers.telnyx.com/api-reference/call-commands/speak)
* **Agent SDK** — [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk) (repo path `edge-compute-statefulactor`)

Ideas to extend the sample:

1. **Close jobs from the field.** Add an `@rpc closeJob(seq)` method and a `POST /jobs/:seq/close` route so the dispatcher can flip `open` → `closed` and watch the tally move.
2. **Swap the regex parser for inference.** Route the final segment through the `TELNYX` binding's `ai.openai.chat.createCompletion` with a JSON-schema prompt, and keep `parseJob` as the fallback when the model is unavailable.
3. **Multi-line dispatch.** Change `idFromName` to `shift-YYYY-MM-DD:line-<n>` and give each line its own actor — the tally route already takes a shift id, so a `GET /tally?line=` variant is a small change.
4. **Shift-close summary.** Use `this.schedule(0, "closeShift")` at the end of the day to mark remaining `open` rows and speak or SMS the day's tally to the office.
5. **Persist the transcript cursor.** `lastSeq` is already in state — use it to resume mid-stream after a restart instead of relying purely on `seq` idempotency.
