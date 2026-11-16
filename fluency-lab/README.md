---
name: fluency-lab
title: "Fluency Lab — The Pronunciation Desk"
description: "A durable per-clinic actor that owns a Telnyx TTS pronunciation dictionary, applies staff-texted corrections exactly once under 409 races, and re-verifies nightly."
language: typescript
framework: edge
telnyx_products: [text-to-speech, pronunciation-dictionaries, messaging, agent-sdk]
---

# Fluency Lab — The Pronunciation Desk

A Telnyx Edge actor that owns a clinic's pronunciation dictionary as a living, versioned resource — staff text in a correction, the actor PATCHes the dictionary, re-synthesizes the greeting, and re-verifies it every night.

## The Story

At Riverbental Clinic the phone line is the front door, and the recording at the other end has to say "NO-voh-kayn" and "Dr. Ng" the way a pharmacist would — because a patient who mishears a drug name hangs up less confident, and a front desk that has to re-explain the recording burns hours it does not have. The clinic's assistant currently greets callers with "Novo-cane," and nobody on staff can fix it without filing a ticket with a developer. The actor IS the clinic's pronunciation dictionary. It is born the moment the first staff text is forwarded into `env.FLUENCY.idFromName("riverbentalclinic")`, already holding dict v1 with Dr. Ng spoken for; it evolves one PATCH at a time — v1 → v2 when Novocaine arrives, v2 → v3 when Zyrtec does — and it survives the collision of two staff members editing in the same second by re-fetching and re-applying until both terms land exactly once. When the pod is killed mid-edit, the actor wakes with its version, its pending queue, and its 2:00 AM canary intact, synthesizes the canary phrase, and confirms from durable state — not from a rebuilt context — that v2 is still what callers hear. The rest of this README is the API surface of that story.

## Why Telnyx

Pronunciation dictionaries are usually a config file somebody edits once and nobody trusts. On Telnyx they are a first-class, versioned resource on the same **AI Communications Infrastructure** that carries the messages and the audio: `POST /v2/pronunciation_dicts` creates a dictionary with alias and IPA phoneme items, `PATCH /v2/pronunciation_dicts/{id}` bumps it with server-side optimistic locking (a concurrent write returns `409` / code `90200`), and `POST /v2/text-to-speech/speech` applies the dictionary automatically before synthesis via `pronunciation_dict_id`. That means a staff text can drive a real platform mutation, the actor can retry it safely, and the audible result is one REST call away — no separate voice vendor, no re-recorded prompts, no developer in the loop. Messaging, TTS, and the durable actor runtime all live behind one API key and one bill.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/pronunciation_dicts` | Create the clinic dictionary seeded with the Dr. Ng IPA phoneme item |
| `GET` | `/v2/pronunciation_dicts` | List dictionaries to find an existing `Fluency Lab — <clinicId>` on cold start (live mode) |
| `GET` | `/v2/pronunciation_dicts/{id}` | Re-fetch the current `version` + `items` before a retry, and poll for deletion on the canary pass |
| `PATCH` | `/v2/pronunciation_dicts/{id}` | Append a new item with a full `items` replacement; `409` (code `90200`) on concurrent modification |
| `POST` | `/v2/text-to-speech/speech` | Synthesize the greeting and the nightly canary with `pronunciation_dict_id` |
| `POST` | `/v2/messages` | Reply to staff ("Added Novocaine — dictionary v2") and alert the owner on a missing dictionary |

Inbound: `POST /webhooks/messaging` (Telnyx Messaging webhook, Ed25519-verified).

## Architecture

```
 Staff phone (SMS)                                Telnyx Edge
       │                                              │
       │  "add Novocaine to the dictionary            │
       │   — NO-voh-kayn"                             │
       ▼                                              │
 POST /webhooks/messaging ──► verify Ed25519 over "<ts>|<raw body>", 300s skew
       │                          invalid → 401       │
       │  route does ONE thing:                       │
       │  env.FLUENCY.idFromName(clinicIdFor(to))     │
       ▼                                              │
 ┌──────────────────────────────────────────────────────────────────┐
 │  FluencyLab extends Agent<Env, DictState>   (one per clinic)     │
 │                                                                  │
 │  state: { clinicId, dictId, version, items[], pending[],         │
 │           lastCanaryHash, degraded, lastAppliedVersion }         │
 │                                                                  │
 │  receive(text, from, to, eventId)                                │
 │      └─► ensureDictionary()  ── POST /v2/pronunciation_dicts     │
 │      └─► parseStaffText()    ── alias | /ipa/ phoneme | hint     │
 │      └─► dedupe by item.text (case-insensitive, first-writer)    │
 │      └─► queue PendingEdit{ eventId, item, appliedBy }           │
 │      └─► applyEdit(eventId)                                      │
 │                                                                  │
 │  applyEdit(eventId)  ── max 3 attempts                           │
 │      ├─ GET  /v2/pronunciation_dicts/{id}   (fresh version)      │
 │      ├─ PATCH .../{id}  { name, items, version }                 │
 │      │      └─ 409 ──► re-fetch, re-apply, retry                 │
 │      └─ finalizeEdit() ──► dict_log INSERT (once per eventId)    │
 │                        └─► SMS "Added <term> — dictionary v<N>"  │
 │                                                                  │
 │  this.schedule(secondsUntilNext(VERIFY_AT, CLINIC_TZ),           │
 │                "canary", {}, { id: "verify:<clinicId>" })        │
 │  canary()                                                        │
 │      ├─ GET .../{id}  ── 404 ──► degraded=true + owner SMS       │
 │      ├─ POST /v2/text-to-speech/speech (CANARY_TEXT)             │
 │      ├─ SHA-256(audio) vs lastCanaryHash ──► match | drift       │
 │      ├─ dict_log INSERT (version used)                           │
 │      └─ re-arm itself (no recurring flag — delay is recomputed)  │
 └──────────────────────────────────────────────────────────────────┘
       │
       ▼
 GET /greeting-audio ──► audio/mpeg  (front desk plays it, hears the fix)
```

The webhook route holds **no business logic** — it derives `clinicId` from the `to` number via `CLINIC_NUMBERS` (falling back to `INTAKE_NUMBER` → `riverbentalclinic`), forwards `{ text, from, to, eventId }`, and returns `200`. The actor materializes itself on that first `.receive()`; it is never constructed by an HTTP route.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) runs the full staff-text → validate → PATCH → synthesis flow against recorded fixtures with no live keys. `false` is the live path — same code paths, real Telnyx APIs. | — |
| `VOICE_ID` | `string` | `Telnyx.Ultra.002622d8-19d0-4567-a16a-f99c7397c062` | no | TTS voice used for the greeting and the canary. | [List available voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices) |
| `GREETING_TEXT` | `string` | `Thank you for calling Riverbental Clinic. Today's flu clinic is open until 6 PM. We can help with Novocaine and Dr. Ng.` | no | Text synthesized by `GET /greeting-audio`. | — |
| `CANARY_TEXT` | `string` | `Welcome to Riverbental Clinic — Novocaine and Dr. Ng.` | no | Text synthesized by the nightly canary; only its SHA-256 hash is stored. | — |
| `VERIFY_AT` | `string` | `02:00` | no | Local wall-clock `HH:MM` for the nightly canary, interpreted in `CLINIC_TZ`. | — |
| `CLINIC_TZ` | `string` | `UTC` | no | IANA timezone used to interpret `VERIFY_AT`. | — |
| `INTAKE_NUMBER` | `string` | `+1555XXXXXXXX` | no | The clinic's intake line; also the `from` number on outbound SMS. | Telnyx Portal → Numbers |
| `CLINIC_NUMBERS` | `string` | `{"+1555XXXXXXXX":"riverbentalclinic"}` | no | JSON map of `+E164 → clinicId`. Unmapped numbers fall back to `INTAKE_NUMBER`'s clinic. | — |
| `OWNER_NUMBER` | `string` | `+1555XXXXXXXX` | no | Receives the degraded-dictionary alert when the canary gets a `404`. | — |

`TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` are declared as `[[secrets]]` in `telnyx.toml` and read via `env.SECRETS.get(...)`. Never commit real values.

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/fluency-lab

# 2. Configure environment
cp .env.example .env
# edit .env — DEMO_MODE=true works with no keys at all

# 3. Install
npm install

# 4. Authenticate the edge CLI (live mode only)
telnyx-edge auth api-key set "$TELNYX_API_KEY"

# 5. Generate binding types from telnyx.toml
npm run types

# 6. Smoke test (no network, no keys)
npx tsx smoke_test.ts

# 7. Deploy
npm run deploy        # → telnyx-edge ship
```

Then point your Telnyx Messaging profile's webhook URL at `https://<your-actor-host>/webhooks/messaging` and text the intake number:

```
add Novocaine to the dictionary — NO-voh-kayn
```

Play the fix at `GET https://<your-actor-host>/greeting-audio`.

**Demo mode vs live mode.** `DEMO_MODE=true` (the default) exercises every code path — parse, dedupe, PATCH, 409 retry, `dict_log` insert, canary hashing — against recorded fixtures: dictionary create/patch are in-memory, TTS returns a bundled silent MP3, SMS is logged instead of sent, and the concurrent-editor race is simulated with a one-shot version bump so the `409 → re-fetch → re-apply` loop actually runs. Set `DEMO_MODE=false` to hit the real Telnyx APIs with the same code.

## API Reference

### `POST /webhooks/messaging`

Telnyx Messaging webhook. Verifies `telnyx-timestamp` + `telnyx-signature-ed25519` (Ed25519 over `"<timestamp>|<raw body>"`, 300s skew) before parsing.

- **Body** (Telnyx envelope): `data.id` (event id, the exactly-once key), `data.payload.from.phone_number`, `data.payload.to[0].phone_number`, `data.payload.text`
- **Responses**: `200 OK` · `400 Bad JSON` / `400 Bad payload` · `401 Missing signature` / `401 Invalid signature` · `500 Server misconfigured` (no public key)

### `GET /greeting-audio`

Synthesizes `GREETING_TEXT` live with the clinic's current `pronunciation_dict_id` and returns the bytes.

- **Response**: `200` with `content-type: audio/mpeg` (a bundled fixture in demo mode)

### Actor methods (`FluencyLab`)

| Method | Signature | Behavior |
|--------|-----------|----------|
| `receive` | `({ text, from, to, eventId }) => Promise<void>` | Ensures the dictionary exists, parses the staff text, dedupes by `item.text` (case-insensitive, first-writer-wins), queues a `PendingEdit`, calls `applyEdit`. Unparseable text replies with a one-line usage hint. |
| `applyEdit` | `(eventId: string) => Promise<void>` | Up to 3 attempts: fetch fresh dictionary → `PATCH` with the full items array → on `409` re-fetch and re-apply → `finalizeEdit` on success. |
| `canary` | `() => Promise<void>` | Polls the dictionary (`404` → `degraded` + owner SMS), synthesizes `CANARY_TEXT`, compares SHA-256 against `lastCanaryHash`, writes a `dict_log` row with the version used, re-arms itself. |
| `getGreetingAudio` | `() => Promise<Uint8Array>` | Ensures the dictionary, then synthesizes `GREETING_TEXT` with the current dict id. |

### Staff-text grammar

```
add <term> to the dictionary — <pron>      # em-dash form
add <term> -> <pron>                       # arrow form
```

`<pron>` wrapped in slashes (`/dɹ.ɛŋ/`) becomes a **phoneme** item with `alphabet: "ipa"`; anything else becomes an **alias** item. So `add Novocaine to the dictionary — NO-voh-kayn` produces `{ text: "Novocaine", type: "alias", alias: "NO-voh-kayn" }`.

### `dict_log` schema

```sql
CREATE TABLE IF NOT EXISTS dict_log(
  clinic_id    TEXT,
  dict_version INT,
  item_text    TEXT,
  item_type    TEXT,
  applied_at   TIMESTAMPTZ,
  applied_by   TEXT
);
```

One row per **newly applied** item per successful PATCH — not the full array. Exactly-once under retry: the row is written once on the first successful PATCH and the edit leaves the pending queue keyed by `eventId`, so a retried attempt never duplicates. `applied_by` is the requesting staff E.164. Canary passes write `__canary_match__` / `__canary_drift__`; a missing dictionary writes `__dictionary_deleted__` with `item_type='system'`.

### Dictionary limits

Enforced client-side before every create/PATCH: **100 items per dictionary**, **200 chars** per `text`, **500 chars** per alias/phoneme value — violations return a friendly staff SMS instead of a failed API call. Documented but not enforced in code: **50 dictionaries per organization**, **1 MB** file upload.

### The 409 retry, precisely

Optimistic locking is **server-side**. There is no `If-Match` / `ETag` header — the version is the `data.version` field on the dictionary response. Each actor method run snapshots the version it read at entry; if another write lands in between, the PATCH returns `409` with error code `90200` ("Dictionary was modified concurrently, please retry"). The actor then `GET`s the dictionary, re-applies its item (deduped by `text`), and retries — max 3 attempts. The final dictionary contains both items exactly once.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Invalid signature` on every webhook | Wrong `TELNYX_PUBLIC_KEY`, or the raw body was re-serialized before verification | Use the account public key from the portal; verify against the **raw** request text, not `JSON.stringify(parsed)` |
| `401 Missing signature` | Webhook URL is not registered on the Messaging profile, or a proxy stripped headers | Re-point the profile's webhook URL at `/webhooks/messaging` |
| Staff text gets the usage hint back | Text didn't match either grammar form | Use `add <term> to the dictionary — <pron>` or `add <term> -> <pron>` |
| Reply says `"X" is already in the dictionary.` | Uniqueness key is `item.text`, case-insensitive, first-writer-wins | Re-adding never merges pronunciations — PATCH the item explicitly if you need to change it |
| `Dictionary update failed after 3 attempts.` | Three consecutive `409`s — heavy concurrent editing | Retry the text; the pending edit is still queued by `eventId` |
| `Dictionary is full (100 items max).` | Hit the per-dictionary item cap | Remove a stale term or create a second dictionary (50/org) |
| Canary never fires | `VERIFY_AT` / `CLINIC_TZ` misparsed, or the actor was never woken | `VERIFY_AT` is `HH:MM` local; the alarm is at-least-once and fires on next wake if the actor slept through it |
| `degraded=true` and an owner SMS arrived | The canary's `GET /v2/pronunciation_dicts/{id}` returned `404` | The dictionary was deleted out-of-band; re-run `ensureDictionary()` by texting the intake number |
| `GET /greeting-audio` returns silence in demo mode | Expected — demo mode returns a bundled silent MP3 fixture | Set `DEMO_MODE=false` with a real key to hear actual synthesis |

## Agent Discovery

- Agent signup and capabilities: <https://telnyx.com/agent-signup.md>
- Telnyx AI agent examples and tooling: <https://github.com/team-telnyx/ai>
- Machine-readable docs index: <https://developers.telnyx.com/llms.txt>

## Related Examples

- [`edge-compute-statefulactor`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-compute-statefulactor) — the base Agent SDK actor pattern this sample extends
- [`per-caller-intake`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/per-caller-intake) — Ed25519 webhook verification precedent used by the messaging route
- [`multi-turn-sms-quiz-agent`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/multi-turn-sms-quiz-agent) — `eventId = hook.data.id` extraction and SMS conversation state
- [`voice-fraud-step-up-agent`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-fraud-step-up-agent) — agent SQL via `this.ctx.storage.sql.exec(...)` for durable audit tables

## Resources

- [Pronunciation Dictionaries (docs)](https://developers.telnyx.com/docs/voice/tts/pronunciation-dictionaries)
- [Create a pronunciation dictionary (API reference)](https://developers.telnyx.com/api-reference/pronunciation-dictionaries/create-a-pronunciation-dictionary)
- [List available voices (API reference)](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- [Text-to-Speech overview (docs)](https://developers.telnyx.com/docs/voice/tts/overview)
- [Agent SDK (docs)](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Text-to-Speech product page](https://telnyx.com/products/text-to-speech)
- [Telnyx pricing](https://telnyx.com/pricing)
