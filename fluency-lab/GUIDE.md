# The Fluency Lab — Teaching Text-to-Speech to Say Your Brand Right

A staff text message becomes a durable pronunciation-dictionary edit, a re-synthesized greeting, and a nightly canary that proves the fix is still live — all owned by one long-lived actor per clinic.

This guide walks through `src/index.ts` feature by feature. By the end you'll understand why the dictionary is an actor and not a curl script, how the 409 retry loop keeps concurrent edits exactly-once, and how to flip the sample from safe demo mode to the live Telnyx API.

---

## Table of contents

1. [What you'll build](#what-youll-build)
2. [Prerequisites](#prerequisites)
3. [Project layout](#project-layout)
4. [Environment variables](#environment-variables)
5. [Setup](#setup)
6. [Demo mode vs. live mode](#demo-mode-vs-live-mode)
7. [Walkthrough](#walkthrough)
   - [The webhook route is deliberately dumb](#1-the-webhook-route-is-deliberately-dumb)
   - [Verifying the Telnyx signature](#2-verifying-the-telnyx-signature)
   - [The actor is born on the first staff text](#3-the-actor-is-born-on-the-first-staff-text)
   - [Parsing staff text into a dictionary item](#4-parsing-staff-text-into-a-dictionary-item)
   - [Bootstrapping the dictionary (v1)](#5-bootstrapping-the-dictionary-v1)
   - [Applying an edit — the 409 loop](#6-applying-an-edit--the-409-loop)
   - [finalizeEdit and the dict_log](#7-finalizeedit-and-the-dict_log)
   - [Hearing the fix — GET /greeting-audio](#8-hearing-the-fix--get-greeting-audio)
   - [The nightly canary](#9-the-nightly-canary)
   - [When the dictionary disappears](#10-when-the-dictionary-disappears)
8. [The demo flow, mapped to code](#the-demo-flow-mapped-to-code)
9. [Telnyx primitives used](#telnyx-primitives-used)
10. [Testing](#testing)
11. [Troubleshooting](#troubleshooting)
12. [Next steps](#next-steps)

---

## What you'll build

A single Edge actor, `FluencyLab`, that owns one Telnyx **Pronunciation Dictionary** per clinic. It:

- receives staff SMS through a thin webhook route,
- parses `add <term> to the dictionary — <pron>` into an alias or IPA phoneme item,
- PATCHes the dictionary with optimistic-lock retry (`409` → re-fetch → re-apply, max 3 attempts),
- re-synthesizes the clinic greeting with the new `pronunciation_dict_id` so the front desk can hear the fix,
- writes one `dict_log` row per applied item into agent SQL,
- re-arms a nightly canary at `VERIFY_AT` (default `02:00` local) that hashes a canary phrase and flags drift,
- survives a pod kill: state, pending edits, and the canary schedule all live in the actor, not in memory.

The dictionary is a first-class Telnyx resource — up to 100 items, alias or IPA phoneme, applied automatically before synthesis, versioned, and guarded by a server-side optimistic lock that returns `409` with error code `90200` on concurrent modification.

---

## Prerequisites

- **Node.js 20+** and npm
- The **`telnyx-edge` CLI** (`npm i -g @telnyx/edge-cli` or your team's install path)
- A **Telnyx account** with:
  - an API key (`TELNYX_API_KEY`)
  - your account's **webhook public key** (`TELNYX_PUBLIC_KEY`) — used to verify inbound Ed25519 signatures
  - a messaging-enabled phone number (the "intake number")
- A phone you can text from (for live mode) — or nothing at all, since demo mode is the default

You do **not** need a Call Control application. This sample never answers a call; the "doctor calls the clinic line" moment is demonstrated by synthesizing the greeting audio with the new dictionary id.

---

## Project layout

```
fluency-lab/
├── src/
│   └── index.ts          # actor, REST client, webhook route, fetch handler
├── package.json          # @telnyx/edge-runtime, deploy/types scripts
├── tsconfig.json         # ES2022, bundler resolution, strict
├── telnyx.toml           # actor binding, secrets, env vars
├── .env.example          # placeholder values only
├── .gitignore
├── smoke_test.ts         # loads the module, exercises the pure helpers
├── README.md
├── API.md
└── GUIDE.md              # this file
```

`src/index.ts` is organized into five sections, top to bottom:

| Section | What lives there |
| --- | --- |
| Types & interfaces | `Env`, `DictItem`, `PendingEdit`, `DictState`, `DictResponse` |
| Helpers | `clinicIdFor`, `parseStaffText`, `isDemo`, `silentMp3`, `sha256Hex`, `secondsUntilNext`, `maskPhone`, `b64ToBytes`, `verifyTelnyxSignature` |
| `TelnyxApi` | thin REST wrapper for dictionaries, TTS, and SMS |
| `FluencyLab` | the `Agent<Env, DictState>` subclass |
| Fetch handler | `POST /webhooks/messaging`, `GET /greeting-audio` |

---

## Environment variables

| Variable | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `TELNYX_API_KEY` | secret | — | Bearer token for all `api.telnyx.com` calls |
| `TELNYX_PUBLIC_KEY` | secret | — | Base64 Ed25519 public key used to verify webhook signatures |
| `DEMO_MODE` | env var | `true` | `true` = fixtures, no network. `false` = live Telnyx API |
| `VOICE_ID` | env var | `Telnyx.Ultra.002622d8-19d0-4567-a16a-f99c7397c062` | Voice used for greeting + canary synthesis |
| `GREETING_TEXT` | env var | `Thank you for calling Riverbental Clinic. Today's flu clinic is open until 6 PM. We can help with Novocaine and Dr. Ng.` | Text synthesized by `GET /greeting-audio` |
| `CANARY_TEXT` | env var | `Welcome to Riverbental Clinic — Novocaine and Dr. Ng.` | Text synthesized by the nightly canary |
| `VERIFY_AT` | env var | `02:00` | Local wall-clock time for the canary, `HH:MM` |
| `CLINIC_TZ` | env var | `UTC` | IANA timezone that `VERIFY_AT` is interpreted in |
| `INTAKE_NUMBER` | env var | `+1555XXXXXXXX` | The `from` number for outbound SMS and the default clinic lookup |
| `CLINIC_NUMBERS` | env var | `{}` | JSON map of `+E164 → clinicId`; unmatched numbers fall back to `riverbentalclinic` |
| `OWNER_NUMBER` | env var | `+1555XXXXXXXX` | Where degraded-mode alerts go |

`.env.example` ships with placeholders only. Never commit real numbers or keys.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Authenticate the CLI
telnyx-edge auth api-key set $TELNYX_API_KEY

# 3. Register secrets (these are read via env.SECRETS.get(...))
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "your_webhook_public_key_here"

# 4. Generate telnyx-env.d.ts from telnyx.toml bindings
telnyx-edge types

# 5. Deploy
telnyx-edge ship
```

Then point your Telnyx Messaging profile's inbound webhook at:

```
https://<your-worker-host>/webhooks/messaging
```

That's the only webhook this sample needs. There is no Call Control webhook, and no dictionary-deleted webhook exists in the Telnyx API — deletion is detected by polling during the canary pass (see [section 10](#10-when-the-dictionary-disappears)).

---

## Demo mode vs. live mode

`DEMO_MODE` defaults to `"true"`. The switch is read by `isDemo()` and consulted at exactly five seams:

| Seam | Demo behavior | Live behavior |
| --- | --- | --- |
| `createDictionary()` | returns `{ id: "demo-Fluency Lab — <clinicId>", version: 1, items }` | `POST /v2/pronunciation_dicts` |
| `fetchDictionary()` | returns the dictionary reconstructed from actor state | `GET /v2/pronunciation_dicts/{id}` |
| `patchDictionary()` | mutates state, bumps `version`, and simulates one `409` when more than one edit is queued | `PATCH /v2/pronunciation_dicts/{id}` with `{ name, items, version }` |
| `synthesize()` | returns a short silent MP3 (`silentMp3()`) | `POST /v2/text-to-speech/speech` |
| `reply()` | logs `[DEMO] SMS -> +1***45: <text>` with the phone masked | `POST /v2/messages` |

Everything else — the webhook route, signature verification, the parser, the retry loop, the SQL change log, the canary schedule — runs identically in both modes. That's the point: the demo exercises the same code paths, just against fixtures.

**Signature verification is never faked.** Even in demo mode, `POST /webhooks/messaging` rejects requests without a valid `telnyx-timestamp` / `telnyx-signature-ed25519` pair. To exercise the route locally you need to sign the body with the private key matching `TELNYX_PUBLIC_KEY`, or send through the Telnyx portal's webhook tester.

To go live, set `DEMO_MODE = "false"` in the `[env_vars]` block of `telnyx.toml` (or as a deployed env var) and redeploy with `telnyx-edge ship`. No code changes.

---

## Walkthrough

### 1. The webhook route is deliberately dumb

The `fetch` handler at the bottom of `src/index.ts` routes two paths and nothing else:

```ts
if (url.pathname === "/webhooks/messaging" && req.method === "POST") return handleMessaging(req, env);
if (url.pathname === "/greeting-audio"   && req.method === "GET")  return handleGreeting(env);
```

`handleMessaging` does four things and then gets out of the way:

1. reads the raw body as text (needed for signature verification),
2. verifies the Ed25519 signature,
3. pulls `from`, `to`, `text`, and `eventId` out of `data.payload` / `data.id`,
4. forwards to the actor:

```ts
const stub = env.FLUENCY.idFromName(clinicIdFor(to, env)) as unknown as FluencyStub;
await stub.receive({ text, from, to, eventId });
return new Response("OK", { status: 200 });
```

There is **no business logic on the route**. It never constructs actor state, never touches the dictionary, never parses the message. That's the acceptance criterion "actor born via `env.FLUENCY.idFromName(clinicId)` on first staff text, not on an HTTP route" — the route only knows how to find the actor and hand it a message.

`clinicIdFor(to, env)` resolves the destination number through the `CLINIC_NUMBERS` JSON map and falls back to `riverbentalclinic` when the number isn't mapped. That fallback is what makes the demo work with a single intake number.

### 2. Verifying the Telnyx signature

`verifyTelnyxSignature(raw, ts, sigB64, pubKeyB64)` implements the Telnyx webhook contract:

- Reject if `|now − timestamp| > 300` seconds (replay window).
- Import the account public key as an Ed25519 `CryptoKey`.
- Verify the signature over the UTF-8 bytes of `` `${timestamp}|${rawBody}` ``.
- Base64url signatures are normalized to standard base64 before decoding.

Any failure — missing headers, bad key, expired timestamp, wrong signature — returns `401`. A missing `TELNYX_PUBLIC_KEY` secret returns `500` (server misconfiguration, not a client error).

Because the body is read with `req.text()` **before** parsing, the signature covers the exact bytes Telnyx sent. Never `JSON.parse` first and re-stringify; key order and whitespace will change and the signature will fail.

### 3. The actor is born on the first staff text

`FluencyLab extends Agent<Env, DictState>`. The durable state shape is:

```ts
interface DictState {
  clinicId: string;
  dictId: string | null;
  version: number;
  items: DictItem[];
  pending: PendingEdit[];
  lastCanaryHash: string | null;
  degraded: boolean;
  lastAppliedVersion: number;
  demoConflictDone: boolean;
}
```

`receive()` is the actor's entry point. On the very first call it stamps `clinicId` into state — that's the moment the actor materializes. From then on, every subsequent staff text for the same clinic hits the same actor instance with the dictionary version intact. No context reconstruction, no re-fetch of the dictionary id from a database.

`receive()` then:

1. calls `ensureDictionary()` (see [section 5](#5-bootstrapping-the-dictionary-v1)),
2. parses the text with `parseStaffText()`,
3. replies with `USAGE_HINT` if the grammar doesn't match,
4. checks for a case-insensitive duplicate term and replies `"<term>" is already in the dictionary.` if found — first-writer-wins, no PATCH, no merge of pronunciations,
5. appends a `PendingEdit` keyed by `eventId` (idempotent: re-delivery of the same webhook doesn't double-queue),
6. calls `applyEdit(eventId)`.

The `eventId` comes from `hook.data.id` — the top-level webhook event id. It is the exactly-once key for both the pending queue and the change log.

### 4. Parsing staff text into a dictionary item

`parseStaffText(text)` accepts two forms:

```
add Novocaine to the dictionary — NO-voh-kayn
add Novocaine -> NO-voh-kayn
```

The em-dash form matches `[—–-]`, so an en-dash or a plain hyphen works too. The pronunciation format decides the item type:

- **Wrapped in slashes** (`/noʊvoʊkeɪn/`) → `{ text, type: "phoneme", phoneme: <inner>, alphabet: "ipa" }`
- **Anything else** (`NO-voh-kayn`) → `{ text, type: "alias", alias: <pron> }`

The demo's `NO-voh-kayn` is a respelling, so the Novocaine item is an **alias**, not a phoneme. The spec's demo-flow wording ("creates the dictionary item (type: phoneme)") describes the *intent* — the actor creates a dictionary item — while the type follows the pronunciation format.

The parser also enforces the API's field limits up front: `text ≤ 200` chars, pronunciation `≤ 500` chars. Anything that fails returns `null`, and `receive()` replies with the one-line usage hint.

### 5. Bootstrapping the dictionary (v1)

`ensureDictionary()` is idempotent and runs on both `receive()` and `getGreetingAudio()`:

- If `state.dictId` is already set, return immediately.
- In live mode, list dictionaries and look for one named `Fluency Lab — <clinicId>`. If found, adopt its `id`, `version`, and `items` — no duplicate create.
- Otherwise create it with a single seeded item:

```ts
const DR_NG_ITEM: DictItem = { text: "Dr. Ng", type: "phoneme", phoneme: "dɹ.ɛŋ", alphabet: "ipa" };
```

So **v1 contains the IPA phoneme item**. The first staff text (Novocaine, alias) PATCHes v1 → v2, which is the moment the acceptance criterion "at least one IPA phoneme item and one alias item" is satisfied. A later staff text (Zyrtec, `ZEER-teck`) PATCHes v2 → v3 — the "then PATCHes it with a new item" criterion.

Seeding both item types at create time was deliberately rejected: it would leave no staff-driven PATCH in the demo flow.

After a successful create or adopt, `ensureDictionary()` calls `scheduleNextCanary(clinicId)` to arm the nightly timer.

### 6. Applying an edit — the 409 loop

`applyEdit(eventId)` is the heart of the sample. It runs up to **three attempts**:

```
for attempt in 0..2:
  current = fetchDictionary()          # fresh read every attempt
  if current is null          -> markDegraded(); return
  if term already present     -> finalizeEdit(); return   # idempotent
  if current.items.length>=100-> reply("Dictionary is full"); return
  res = patchDictionary(current.id, current.name, [...current.items, edit.item], current.version)
  if res.ok                   -> finalizeEdit(res.data.version); return
  if res.status === 409       -> continue                 # re-fetch and retry
  else                        -> reply(error); return
reply("Dictionary update failed after 3 attempts.")
```

Two things make this correct:

**The PATCH sends a full replacement `items` array plus the `version` it read.** Telnyx's optimistic locking is server-side — there is no `If-Match` / `ETag` header. A concurrent PATCH bumps the dictionary version, so a stale write arrives with an old `version` and the server replies `409` with error code `90200` ("Dictionary was modified concurrently, please retry"). The loop's response is to re-fetch with `GET /v2/pronunciation_dicts/{id}`, re-apply the item on the fresh array, and retry.

**Dedupe by `text` on every attempt.** If the concurrent editor happened to add the same term, the loop's `current.items.some(...)` check short-circuits to `finalizeEdit()` instead of appending a duplicate. The final dictionary contains both items exactly once.

> **Assumption noted in the code:** the PATCH body includes `version` so the server can reject stale writes. If the live API ignores the field, the retry loop still works — it just won't observe a `409`.

In demo mode, `patchDictionary()` simulates the race: when more than one edit is queued and `demoConflictDone` is still `false`, it bumps `state.version` and returns a synthetic `409`. The next attempt re-reads the bumped version, re-applies, and succeeds. The `demoConflictDone` flag makes the simulation one-shot so the demo doesn't loop forever.

### 7. finalizeEdit and the dict_log

`finalizeEdit(eventId, version, edit)` is the single exit point for a successful edit. It:

1. removes the edit from `state.pending` (keyed by `eventId` — a retried attempt can never log twice),
2. writes `version` and `lastAppliedVersion` into state,
3. appends one row to `dict_log`,
4. sends the confirmation SMS: `Added <term> — dictionary v<N>`.

`logDict()` creates the table on first use and inserts:

```sql
CREATE TABLE IF NOT EXISTS dict_log(
  clinic_id TEXT, dict_version INT, item_text TEXT,
  item_type TEXT, applied_at TIMESTAMPTZ, applied_by TEXT
)
```

That is the exact schema the acceptance criteria name. One row per **newly applied item** — not the full array. `applied_by` is the requesting staff member's E.164.

The same table carries three system rows written by other paths:

| `item_text` | `item_type` | Written by |
| --- | --- | --- |
| `__canary_match__` | `system` | canary, hash unchanged |
| `__canary_drift__` | `system` | canary, hash changed |
| `__dictionary_deleted__` | `system` | canary found a `404` |

### 8. Hearing the fix — GET /greeting-audio

There is no MMS and no Call Control leg. The audible confirmation is an HTTP route:

```ts
async getGreetingAudio(): Promise<Uint8Array> {
  // ensure the actor + dictionary exist, then:
  return await this.synthesize(this.env.GREETING_TEXT, s.dictId || "");
}
```

`synthesize()` posts to `POST /v2/text-to-speech/speech` with:

```json
{ "text": "<GREETING_TEXT>", "voice": "<VOICE_ID>", "pronunciation_dict_id": "<current dict id>" }
```

The audio bytes come back directly and are returned as `audio/mpeg`. Open `https://<your-worker-host>/greeting-audio` in a browser after a staff edit and you'll hear "NO-voh-kayn" instead of "Novo-cane". In demo mode the route returns the bundled silent MP3 fixture, so the endpoint is always playable.

The dictionary id lives in actor state, so the greeting always synthesizes against the **current** version — no cache to invalidate, no config to redeploy.

### 9. The nightly canary

`scheduleNextCanary(clinicId)` computes the delay to the next `VERIFY_AT` in `CLINIC_TZ` and arms a stable timer:

```ts
await this.schedule(
  secondsUntilNext(this.env.VERIFY_AT, this.env.CLINIC_TZ),
  "canary", {}, { id: `verify:${clinicId}` },
);
```

`this.schedule()` takes a **delay in seconds**, not a cron expression. `secondsUntilNext()` uses `Intl.DateTimeFormat` with the clinic's timezone to compute the delta to the next `HH:MM`, adding 86400 if the time has already passed today, and floors at 60 seconds.

The stable id `verify:<clinicId>` means re-arming replaces the existing timer rather than stacking a second one. There is no recurring flag — the `canary()` handler **re-arms itself** at the end of every run.

`canary()` does:

1. bail out (and re-arm) if `dictId` is unset,
2. `fetchDictionary()` — a `null` result means the dictionary is gone (see next section),
3. synthesize `CANARY_TEXT` with the current dictionary id,
4. SHA-256 the raw audio bytes,
5. compare against `state.lastCanaryHash`,
6. store the new hash and the dictionary version in state,
7. log `__canary_match__` or `__canary_drift__` with the version used,
8. re-arm.

**Resume proof.** If the pod is killed right after a PATCH, the alarm fires on the next wake (at-least-once delivery). The handler reads `dictId` and `version` from durable actor state — not from a rebuilt context — synthesizes the canary, and logs the version that's actually live. That's the acceptance criterion: the canary confirms v2 from state, not from memory.

### 10. When the dictionary disappears

Telnyx does not publish a dictionary-deleted webhook. The sample handles deletion by polling during the canary pass: `fetchDictionary()` returns `null` on a `404`, and `markDegraded(clinicId)` runs:

- sets `degraded: true` in state,
- writes a `dict_log` note row: `item_text='__dictionary_deleted__'`, `item_type='system'`, `dict_version` = the last known version, `applied_by='system'`,
- SMSes `OWNER_NUMBER` with a one-line alert.

The architecture diagram's `onDictionaryDeleted(webhook)` maps to this poll. `applyEdit()` also calls `markDegraded()` if a fetch returns `null` mid-edit, so a deletion between edits surfaces immediately rather than at 2 AM.

---

## The demo flow, mapped to code

| Demo step | What happens | Where in `src/index.ts` |
| --- | --- | --- |
| 9:00 — actor holds dict v1 | `ensureDictionary()` creates `Fluency Lab — riverbentalclinic` seeded with the Dr. Ng IPA phoneme | `ensureDictionary`, `createDictionary`, `DR_NG_ITEM` |
| 9:05 — pharmacist texts "Add Novocaine…" | webhook → signature check → `idFromName` → `receive()` → `parseStaffText()` returns an **alias** item | `handleMessaging`, `receive`, `parseStaffText` |
| 9:06 — PATCH v1 → v2, re-synthesize | `applyEdit()` appends the item and PATCHes; `GET /greeting-audio` synthesizes with the new dict id | `applyEdit`, `patchDictionary`, `getGreetingAudio` |
| 9:20 — second staff member, same term | duplicate check replies "already in the dictionary" — idempotent, no lost edit | `receive` (duplicate branch) |
| 9:20 — two *different* terms in the same second | one PATCH wins; the loser gets `409` → re-fetch → re-apply; both items land exactly once | `applyEdit` retry loop |
| 9:32 — doctor calls, greeting is correct | `GET /greeting-audio` returns audio synthesized with the current `pronunciation_dict_id`; the version is logged | `getGreetingAudio`, `logDict` |
| 4:45 PM — schedule the nightly re-verify | `scheduleNextCanary()` arms `verify:riverbentalclinic` for the next 02:00 local | `scheduleNextCanary`, `secondsUntilNext` |
| Pod killed after step 3 | the alarm fires on wake; `canary()` reads `dictId`/`version` from state, hashes, logs | `canary`, `logDict` |

---

## Telnyx primitives used

**Agent SDK — `Agent<Env, DictState>`**
The durable entity. `getState()` / `setState()` merge-patch semantics mean `setState({ pending })` touches only `pending`. Public async methods (`receive`, `applyEdit`, `canary`, `getGreetingAudio`) are auto-RPC-callable from the stub returned by `env.FLUENCY.idFromName(...)`.

**`this.schedule(delaySeconds, method, payload, { id })`**
Nightly canary timer with a stable id (`verify:<clinicId>`). Delay-based, not cron. The handler re-arms itself. Survives restarts; fires on next wake if the actor was asleep.

**Agent SQL — `this.ctx.storage.sql`**
The `dict_log` change log. `sql.exec(...)` for DDL and inserts, `.toArray()` for reads. Table created on first use with `CREATE TABLE IF NOT EXISTS`.

**Pronunciation Dictionaries API**
- `POST /v2/pronunciation_dicts` — create with `{ name, items[] }`; items are `{ text, type: "alias", alias }` or `{ text, type: "phoneme", phoneme, alphabet: "ipa" }`
- `GET /v2/pronunciation_dicts/{id}` — re-fetch on `409`, and poll for deletion during the canary
- `GET /v2/pronunciation_dicts` — adopt an existing dictionary by name in live mode
- `PATCH /v2/pronunciation_dicts/{id}` — full replacement `items` array; server-side optimistic lock returns `409` / code `90200` on concurrent modification
- Limits: 50 dictionaries per org, 100 items per dictionary, text ≤ 200 chars, value ≤ 500 chars, 1 MB upload

**TTS REST — `POST /v2/text-to-speech/speech`**
`{ text, voice, pronunciation_dict_id }` → audio bytes. Used for both the audible greeting (`GET /greeting-audio`) and the internal canary. The dictionary is applied automatically before synthesis.

**Messaging — `POST /v2/messages`**
`{ from: INTAKE_NUMBER, to: <staff or owner E.164>, text }`. One confirmation per applied edit, one usage hint per malformed text, one alert on degraded mode.

**Webhook signature verification**
Ed25519 over `` `${telnyx-timestamp}|${rawBody}` ``, 300-second skew cap, `401` on failure. Implemented with `crypto.subtle` — no SDK dependency on the hot path.

---

## Testing

```bash
npx tsx smoke_test.ts
```

The smoke test imports `src/index.ts` and asserts the module loads, then exercises the pure helpers that don't need a network or a signature:

- `parseStaffText("add Novocaine to the dictionary — NO-voh-kayn")` → alias item
- `parseStaffText("add Dr. Ng -> /dɹ.ɛŋ/")` → IPA phoneme item
- `parseStaffText("hello")` → `null`
- `clinicIdFor("+15550001111", env)` → mapped clinic id, and the `riverbentalclinic` fallback
- `verifyTelnyxSignature(...)` → `false` for an expired timestamp and for a garbage signature

Because signature verification is never bypassed, the webhook route itself is tested end-to-end through the Telnyx portal's webhook tester (or by signing a body with the matching private key), not by `curl`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Missing signature` | Request didn't come from Telnyx, or a proxy stripped headers | Send through the Telnyx portal tester; check the messaging profile's webhook URL |
| `401 Invalid signature` | Wrong `TELNYX_PUBLIC_KEY`, or the body was parsed and re-stringified before verification | Re-copy the account public key; verify `req.text()` is read before `JSON.parse` |
| `500 Server misconfigured` | `TELNYX_PUBLIC_KEY` secret not set | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "..."` then `telnyx-edge ship` |
| Staff text gets the usage hint | Grammar didn't match | Use `add <term> to the dictionary — <pron>` or `add <term> -> <pron>` |
| `"<term>" is already in the dictionary.` | Case-insensitive duplicate | Expected — first-writer-wins, no pronunciation merge |
| `Dictionary update failed after 3 attempts.` | Three consecutive `409`s | Rare; check for a runaway concurrent editor. The pending edit stays queued for the next text |
| Canary never fires | `VERIFY_AT` / `CLINIC_TZ` misconfigured, or the actor was never created | `VERIFY_AT` is `HH:MM`; `CLINIC_TZ` is IANA. The timer arms on first `ensureDictionary()` |
| `degraded: true` in state | Dictionary returned `404` | Recreate it, or clear `dictId` in state so `ensureDictionary()` rebuilds |
| Greeting audio is silent | You're in demo mode | Expected — demo returns a silent MP3 fixture. Set `DEMO_MODE=false` for real audio |

---

## Next steps

- **Pronunciation Dictionaries docs** — [developers.telnyx.com/docs/voice/tts/pronunciation-dictionaries](https://developers.telnyx.com/docs/voice/tts/pronunciation-dictionaries)
- **Create a pronunciation dictionary (API reference)** — [developers.telnyx.com/api-reference/pronunciation-dictionaries/create-a-pronunciation-dictionary](https://developers.telnyx.com/api-reference/pronunciation-dictionaries/create-a-pronunciation-dictionary)
- **List available voices** — [developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **TTS overview** — [developers.telnyx.com/docs/voice/tts/overview](https://developers.telnyx.com/docs/voice/tts/overview)
- **Agent SDK** — [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- **Messaging API** — [developers.telnyx.com/docs/messaging/messages](https://developers.telnyx.com/docs/messaging/messages)

Ideas to extend the sample:

- Add a `remove <term>` grammar that PATCHes the item out and logs a `removed` row.
- Fan the canary out across every clinic in `CLINIC_NUMBERS` with one timer per `clinicId`.
- Surface `dict_log` through a read-only `GET /changes` route so the front desk can see the audit trail.
- Swap the alias grammar for a strict IPA validator that rejects malformed phoneme strings before the PATCH.
- Wire `GET /greeting-audio` into a Call Control `answer` + `playback` flow to hear the fix on a real inbound call.
