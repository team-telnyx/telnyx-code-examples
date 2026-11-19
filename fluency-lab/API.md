# API Reference — `fluency-lab`

Typed contract for every HTTP surface this sample exposes, the actor RPC methods behind them, and the outbound Telnyx endpoints the `FluencyLab` actor calls.

Base URL (local / deployed): `http://localhost:8787` · `https://<actor-host>`

| Surface | Direction | Auth |
|---|---|---|
| `POST /webhooks/messaging` | inbound (Telnyx → sample) | Ed25519 webhook signature |
| `GET /greeting-audio` | inbound (operator → sample) | optional `Authorization: Bearer <AUDIO_ACCESS_TOKEN>` (required only when the secret is set) |
| `FluencyLab` actor RPC | internal (route → actor) | platform-internal |
| `api.telnyx.com/v2/*` | outbound (actor → Telnyx) | `Bearer $TELNYX_API_KEY` |

---

## 1. `POST /webhooks/messaging`

Receives a Telnyx Messaging webhook for an inbound staff SMS. The route's **only** job is signature verification, payload extraction, and forwarding to the clinic's actor:

```ts
env.FLUENCY.idFromName(clinicIdFor(to, env)).receive({ text, from, to, eventId })
```

No dictionary logic, no synthesis, no SQL runs on the route.

### Headers

| Header | Type | Required | Description |
|---|---|---|---|
| `telnyx-timestamp` | string (unix seconds) | **yes** | Signed timestamp. Rejected if `abs(now - ts) > 300` seconds. |
| `telnyx-signature-ed25519` | string (base64url) | **yes** | Ed25519 signature over the UTF-8 bytes of `` `${timestamp}|${rawBody}` ``. |
| `content-type` | string | no | Body is read as raw text and parsed after verification; `application/json` expected. |

The verification key is read from the `TELNYX_PUBLIC_KEY` secret (`await env.SECRETS.get("TELNYX_PUBLIC_KEY")`).

### Request body

Raw JSON, verified **before** parsing.

| Field | Type | Required | Description |
|---|---|---|---|
| `data.id` | string | **yes** | Top-level webhook event id. Used as the exactly-once key for the pending-edit queue and `dict_log`. |
| `data.payload.from.phone_number` | string (E.164) | **yes** | Sender. Becomes `applied_by` on the `dict_log` row and the SMS reply target. |
| `data.payload.to[0].phone_number` | string (E.164) | **yes** | Receiving clinic line. Resolved to a `clinicId` via `CLINIC_NUMBERS`. |
| `data.payload.text` | string | **yes** | The staff message. Parsed against the dictionary grammar (see §1.1). |

`clinicId` resolution order:
1. `CLINIC_NUMBERS` env (JSON object `{"+E164": "clinicId"}`) — exact match on `to`.
2. Fallback literal `riverbentalclinic`.

### Example request

```bash
TS=$(date +%s)
BODY='{
  "data": {
    "id": "evt_01J8Z9K3QX",
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+15551230001" },
      "to":   [ { "phone_number": "+15551230000" } ],
      "text": "Add Novocaine to the dictionary — NO-voh-kayn"
    }
  }
}'

# signature = base64url(ed25519_sign(publicKey, `${TS}|${BODY}`))
curl -X POST http://localhost:8787/webhooks/messaging \
  -H "content-type: application/json" \
  -H "telnyx-timestamp: $TS" \
  -H "telnyx-signature-ed25519: $SIGNATURE" \
  --data-raw "$BODY"
```

### Response

`200 OK` — plain text body `OK`. The actor has accepted the edit into its pending queue; the PATCH, `dict_log` write, and confirmation SMS happen asynchronously inside the actor.

```
HTTP/1.1 200 OK
content-type: text/plain

OK
```

### Status codes

| Status | Body | Condition |
|---|---|---|
| `200` | `OK` | Signature valid, payload complete, forwarded to the actor. |
| `400` | `Bad JSON` | Body is not parseable JSON. |
| `400` | `Bad payload` | Any of `from`, `to`, `text`, `eventId` missing after parsing. |
| `401` | `Missing signature` | `telnyx-timestamp` or `telnyx-signature-ed25519` header absent. |
| `401` | `Invalid signature` | Ed25519 verify failed, or timestamp skew > 300s. |
| `500` | `Server misconfigured` | `TELNYX_PUBLIC_KEY` secret not set. |

> The route never returns `409` — dictionary conflicts are resolved inside the actor's retry loop and surfaced to staff over SMS, not over HTTP.

### 1.1 Staff-text grammar (parsed inside the actor)

| Form | Example | Resulting item |
|---|---|---|
| Em-dash | `add Novocaine to the dictionary — NO-voh-kayn` | `{ text: "Novocaine", type: "alias", alias: "NO-voh-kayn" }` |
| Arrow | `add Novocaine -> NO-voh-kayn` | same as above |
| Slash-wrapped pronunciation | `add Ng -> /dɹ.ɛŋ/` | `{ text: "Ng", type: "phoneme", phoneme: "dɹ.ɛŋ", alphabet: "ipa" }` |
| Anything else | `hi` | No item; actor replies with `USAGE_HINT` |

Preflight rejects `term.length > 200` or `pron.length > 500` (treated as unparseable → usage hint).

---

## 2. `GET /greeting-audio`

Synthesizes `GREETING_TEXT` with the clinic's **current** `pronunciation_dict_id` and returns the raw audio. This is the "front desk hears the fix" surface — no MMS, no Call Control leg.

### Request

No parameters, no body. Auth: none by default; when the `AUDIO_ACCESS_TOKEN` secret is set, the request must carry `Authorization: Bearer <AUDIO_ACCESS_TOKEN>` (otherwise `401`).

```bash
curl -sS http://localhost:8787/greeting-audio --output greeting.mp3
```

The handler resolves the clinic from `INTAKE_NUMBER`, calls `ensureDictionary()` (creating dict v1 seeded with the `Dr. Ng` IPA phoneme on first use), then `POST /v2/text-to-speech/speech`.

### Response

`200 OK` — `audio/mpeg` bytes.

```
HTTP/1.1 200 OK
content-type: audio/mpeg

<binary MP3>
```

In `DEMO_MODE=true` the body is a bundled silent MP3 fixture (`silentMp3()`, 10 × 417-byte frames) rather than a live synthesis.

### Status codes

| Status | Body | Condition |
|---|---|---|
| `200` | `audio/mpeg` bytes | Synthesis succeeded (live) or fixture returned (demo). |
| `500` | runtime error page | Upstream `POST /v2/text-to-speech/speech` failed, or `TELNYX_API_KEY` missing in live mode. |

---

## 3. Catch-all

| Status | Body | Condition |
|---|---|---|
| `404` | `Not found` | Any path other than the two above, or wrong method on a known path. |

---

## 4. Actor RPC surface (`FluencyLab`)

Public async methods on `class FluencyLab extends Agent<Env, DictState>`, invoked through `env.FLUENCY.idFromName(clinicId)`.

### `receive(payload)`

```ts
receive(payload: { text: string; from: string; to: string; eventId: string }): Promise<void>
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Raw staff SMS body. |
| `from` | string (E.164) | yes | Staff sender → `applied_by`, reply target. |
| `to` | string (E.164) | yes | Clinic line → `clinicId`. |
| `eventId` | string | yes | Exactly-once key; dedupes the pending queue and the `dict_log` row. |

Flow: `ensureDictionary()` → `parseStaffText()` → case-insensitive uniqueness check on `item.text` (duplicate → `"<term>" is already in the dictionary.`, no PATCH) → enqueue `PendingEdit` → `applyEdit(eventId)`.

### `applyEdit(eventId)`

```ts
applyEdit(eventId: string): Promise<void>
```

Optimistic-lock loop, max **3** attempts:

1. `GET /v2/pronunciation_dicts/{id}` → snapshot `version` + `items`.
2. If the term already exists on the fresh snapshot → `finalizeEdit()` (idempotent, no PATCH).
3. If `items.length >= 100` → reply `Dictionary is full (100 items max).`
4. `PATCH /v2/pronunciation_dicts/{id}` with the full replacement `items` array (body: `{ name, items }` — no version field, no If-Match).
5. On `409` → loop (re-fetch, re-apply). On other non-2xx → reply `Could not update dictionary: <error>`.
6. Exhausted → reply `Dictionary update failed after 3 attempts.`

### `canary()`

```ts
canary(): Promise<void>
```

Scheduled task, stable id `verify:<clinicId>`. Synthesizes `CANARY_TEXT`, SHA-256s the raw audio bytes, compares against `state.lastCanaryHash`, writes `dict_log` rows (`__canary_match__` / `__canary_drift__`, plus `__canary_state_confirmed__` / `__canary_state_mismatch__` for the version-from-state resume proof), then re-arms itself via `scheduleNextCanary()` — in a `finally`, so a failed pass can never stop the nightly re-verify.

### `resynthesizeGreeting()`

```ts
resynthesizeGreeting(version: number): Promise<void>
```

Called automatically from `finalizeEdit()` after every successful PATCH: synthesizes `GREETING_TEXT` with the new `pronunciation_dict_id`, stores `lastGreetingHash` / `lastGreetingVersion` in state, and logs `__greeting_resynthesized__`. A synthesis failure is logged (`__greeting_resynthesis_failed__`) and never fails the edit confirmation.

### `getGreetingAudio()`

```ts
getGreetingAudio(): Promise<Uint8Array>
```

Backing method for `GET /greeting-audio`.

### Actor state (`DictState`)

| Field | Type | Description |
|---|---|---|
| `clinicId` | string | Resolved clinic key; empty until first `receive()`. |
| `dictId` | string \| null | Telnyx dictionary id. |
| `version` | number | Last known dictionary version. |
| `items` | `DictItem[]` | Mirror of the dictionary items (authoritative in demo mode). |
| `pending` | `PendingEdit[]` | Queued edits keyed by `eventId`. |
| `lastCanaryHash` | string \| null | SHA-256 hex of the previous canary audio. |
| `lastGreetingHash` | string \| null | SHA-256 hex of the last post-PATCH greeting synthesis. |
| `lastGreetingVersion` | number | Dictionary version active when the greeting was last re-synthesized. |
| `degraded` | boolean | Set when the dictionary returns `404`. |
| `lastAppliedVersion` | number | Version of the most recent successful PATCH. |
| `demoConflictDone` | boolean | One-shot flag that fires the rival-editor fixture (the simulated 409) in demo mode. |

---

## 5. Outbound Telnyx endpoints

All calls use `Authorization: Bearer <TELNYX_API_KEY>` and `content-type: application/json` against `https://api.telnyx.com`.

### 5.1 `POST /v2/pronunciation_dicts` — create

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string (1–255) | yes | `Fluency Lab — <clinicId>`. Unique per organization. |
| `items` | `DictItem[]` (1–100) | yes | Seed array. Bootstrap seeds exactly one IPA phoneme: `{ text: "Dr. Ng", type: "phoneme", phoneme: "dɹ.ɛŋ", alphabet: "ipa" }`. |

`DictItem` union:

| Variant | Fields |
|---|---|
| alias | `{ text: string, type: "alias", alias: string }` |
| phoneme | `{ text: string, type: "phoneme", phoneme: string, alphabet: "ipa" }` |

Response `data`: `{ id, name, version, items, created_at, updated_at }`.

```bash
curl -X POST https://api.telnyx.com/v2/pronunciation_dicts \
  -H "authorization: Bearer $TELNYX_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "name": "Fluency Lab — riverbentalclinic",
    "items": [
      { "text": "Dr. Ng", "type": "phoneme", "phoneme": "dɹ.ɛŋ", "alphabet": "ipa" }
    ]
  }'
```

### 5.2 `GET /v2/pronunciation_dicts/{id}` — fetch

Returns `data` with the current `version` and full `items` array. `404` → the actor calls `markDegraded()`: sets `degraded=true`, writes a `dict_log` note row (`item_text='__dictionary_deleted__'`, `item_type='system'`, `applied_by='system'`), and SMSes `OWNER_NUMBER`.

### 5.3 `GET /v2/pronunciation_dicts` — list

Used by `ensureDictionary()` in live mode to match an existing dictionary by name before creating one (no-op if `Fluency Lab — <clinicId>` already exists).

### 5.4 `PATCH /v2/pronunciation_dicts/{id}` — update

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Dictionary name. |
| `items` | `DictItem[]` (1–100) | yes | **Full replacement** array — not a delta. The actor sends `[...current.items, newItem]`. |

Responses:

| Status | Meaning | Actor behavior |
|---|---|---|
| `200` | Applied | `finalizeEdit()` → dequeue, `dict_log` insert, confirmation SMS `Added <term> — dictionary v<N>`, greeting re-synthesis (`__greeting_resynthesized__`). |
| `409` | Concurrent modification (error code `90200`) | Re-fetch, re-apply, retry (max 3). |
| other | Failure | Reply `Could not update dictionary: <error>`. |

> There is **no** `If-Match` / `ETag` header and **no** version field in the request body on this endpoint. Locking is server-side: a write whose base was modified concurrently receives `409` with code `90200`; the retry loop is re-fetch + re-apply.

```bash
curl -X PATCH https://api.telnyx.com/v2/pronunciation_dicts/<dict_id> \
  -H "authorization: Bearer $TELNYX_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "name": "Fluency Lab — riverbentalclinic",
    "items": [
      { "text": "Dr. Ng", "type": "phoneme", "phoneme": "dɹ.ɛŋ", "alphabet": "ipa" },
      { "text": "Novocaine", "type": "alias", "alias": "NO-voh-kayn" }
    ]
  }'
```

### 5.5 `POST /v2/text-to-speech/speech` — synthesize

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | `GREETING_TEXT` for `/greeting-audio`; `CANARY_TEXT` for the canary. |
| `voice` | string | yes | `VOICE_ID`, default `Telnyx.Ultra.002622d8-19d0-4567-a16a-f99c7397c062`. |
| `pronunciation_dict_id` | string | yes | The clinic's current dictionary id. |

Returns raw audio bytes (`audio/mpeg`). No `output_format` override — service default.

### 5.6 `POST /v2/messages` — SMS

| Field | Type | Required | Description |
|---|---|---|---|
| `from` | string (E.164) | yes | `INTAKE_NUMBER`. |
| `to` | string (E.164) | yes | Staff sender, or `OWNER_NUMBER` for the degraded alert. |
| `text` | string | yes | Confirmation, usage hint, duplicate notice, or failure message. |

In `DEMO_MODE=true` this is replaced by `console.log("[DEMO] SMS -> <masked>: <text>")` — no message is sent.

---

## 6. `dict_log` SQL schema

Created on first write via `this.ctx.storage.sql.exec(...)`.

```sql
CREATE TABLE IF NOT EXISTS dict_log (
  clinic_id    TEXT,
  dict_version INT,
  item_text    TEXT,
  item_type    TEXT,
  applied_at   TIMESTAMPTZ,
  applied_by   TEXT
);
```

One row per **newly applied** item per successful PATCH — never the full array. Exactly-once under 409 retry: the row is written once in `finalizeEdit()` and the edit leaves `state.pending` keyed by `eventId`, so a retried attempt cannot double-log.

| `item_type` value | Written by |
|---|---|
| `alias` | Staff edit applied as an alias item |
| `phoneme` | Staff edit applied as an IPA phoneme item |
| `system` | Greeting re-synthesis (`__greeting_resynthesized__` / `__greeting_resynthesis_failed__`), canary (`__canary_match__` / `__canary_drift__`, `__canary_state_confirmed__` / `__canary_state_mismatch__`), or deletion note (`__dictionary_deleted__`) |

---

## 7. Limits

| Limit | Value | Enforced |
|---|---|---|
| Items per dictionary | 100 | Yes — preflight in `applyEdit()` replies `Dictionary is full (100 items max).` |
| `item.text` length | 200 chars | Yes — `parseStaffText()` rejects |
| `item.alias` / `item.phoneme` length | 500 chars | Yes — `parseStaffText()` rejects |
| Dictionaries per organization | 50 | Documented only |
| Dictionary file upload | 1 MB | Documented only (not used by this sample) |
| Webhook timestamp skew | 300 s | Yes — `verifyTelnyxSignature()` |
| PATCH retry attempts | 3 | Yes — `applyEdit()` loop |
