# API Reference — `dispatch-line`

Typed contract for the HTTP surfaces exposed by the Dispatch Line worker
(`src/index.ts`) plus the actor RPC surface reachable through the `DISPATCH`
namespace binding.

Base URL: the deployed worker host (e.g. `https://dispatch-line.<account>.telnyx.app`).
All request and response bodies are `application/json`.

---

## Authentication

| Surface | Mechanism |
|---|---|
| `POST /webhooks/telnyx` | Telnyx Ed25519 webhook signature — headers `telnyx-signature-ed25519` and `telnyx-timestamp`, verified over `${timestamp}\|${rawBody}` against `TELNYX_PUBLIC_KEY`. In demo mode (`DEMO_MODE` unset or `true`) with no public key configured, verification is skipped with a warning. |
| `GET /tally` | None — internal dispatcher surface. Restrict at the edge/network layer in production. |

---

## POST /webhooks/telnyx

Single ingress for all Telnyx Call Control webhooks. The handler verifies the
signature, derives the shift id from `data.occurred_at`, resolves the
`DispatchLine` actor via `env.DISPATCH.idFromName(shiftId)`, and dispatches on
`data.event_type`.

### Headers

| Header | Type | Required | Description |
|---|---|---|---|
| `content-type` | string | yes | `application/json` |
| `telnyx-signature-ed25519` | string (base64) | yes (live) | Ed25519 signature over `${timestamp}\|${rawBody}` |
| `telnyx-timestamp` | string | yes (live) | Unix timestamp used in the signed payload. Signatures more than ±5 minutes from the server clock are rejected as replays |

### Request body — Telnyx event envelope

| Field | Type | Required | Description |
|---|---|---|---|
| `data.id` | string | no | Event id; hashed (FNV-1a) into the segment `seq` when no explicit sequence is present |
| `data.event_type` | string | yes | `call.initiated`, `call.transcription`, `call.hangup`, or any other type (ignored) |
| `data.occurred_at` | string (ISO-8601) | no | Used to derive `shift-YYYY-MM-DD`; defaults to now |
| `data.payload.call_control_id` | string | yes | The call leg id. Missing → `400 missing_call_control_id` |
| `data.payload.transcript` | string | no | Transcript text (transcription events) |
| `data.payload.transcription_data` | object | no | `{ transcript, is_final, sequence }` — alternate transcript shape |
| `data.payload.transcription_data.is_final` | boolean | no | Only `true` (or absent) segments are filed |
| `data.payload.transcription_data.sequence` | integer | no | Explicit segment sequence; falls back to FNV-1a hash of `data.id` |

### Example request

```bash
curl -X POST "https://dispatch-line.<account>.telnyx.app/webhooks/telnyx" \
  -H "content-type: application/json" \
  -H "telnyx-signature-ed25519: <base64-signature>" \
  -H "telnyx-timestamp: 1763560920" \
  -d '{
    "data": {
      "id": "evt_01J9Z8...",
      "event_type": "call.transcription",
      "occurred_at": "2026-11-19T07:02:11Z",
      "payload": {
        "call_control_id": "v3:abc123...",
        "transcript": "swap the actuator on north yard door 3",
        "transcription_data": { "is_final": true, "sequence": 42 }
      }
    }
  }'
```

### Responses

**`call.initiated` → 200**

```json
{
  "ok": true,
  "answer": "ok",
  "shiftId": "shift-2026-11-19",
  "transcription": "ok"
}
```

`answer` / `transcription` are `"ok"`, `"demo"` (demo mode), or `"error:<status>"`.

**`call.transcription` → 200**

```json
{
  "ok": true,
  "shiftId": "shift-2026-11-19",
  "filed": true,
  "linked": false,
  "seq": 42
}
```

`filed` is `true` when a new `shift_log` row was appended; `linked` is `true`
when the segment matched an existing open job (cross-call reference). A linked
note carrying a completion cue ("done", "finished", …) also closes the matched
job; the response then carries `"closed": true` alongside `"linked": true`.

**`call.hangup` → 200**

```json
{
  "ok": true,
  "shiftId": "shift-2026-11-19",
  "stopped": "ok",
  "tally": { "shiftId": "shift-2026-11-19", "open": 6, "closed": 2, "linked": 1, "total": 9 }
}
```

`stopped` is `"ok"`, `"demo"`, `"error:<status>"`, or `"skipped"` when the leg
was already gone.

**Unhandled event type → 200**

```json
{ "ok": true, "shiftId": "shift-2026-11-19", "ignored": "call.answered" }
```

### Status codes

| Code | Body | When |
|---|---|---|
| 200 | event-specific shape above | Event accepted and dispatched |
| 400 | `{ "error": "invalid_json" }` | Body is not valid JSON |
| 400 | `{ "error": "missing_call_control_id" }` | `data.payload.call_control_id` absent |
| 401 | `{ "error": "invalid_signature" }` | Ed25519 verification failed (live mode) |
| 500 | `{ "error": "internal_error" }` | Unhandled exception; details logged server-side only |

---

## GET /tally

Dispatcher surface. Returns the shift tally straight from the `shift_log`
table (not a transcript archive) plus the actor's RPC method list.

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `shift` | string | no | Shift id matching `^shift-\d{4}-\d{2}-\d{2}$`. Defaults to today's shift. |

### Example request

```bash
curl "https://dispatch-line.<account>.telnyx.app/tally?shift=shift-2026-11-19"
```

### Response — 200

```json
{
  "ok": true,
  "shiftId": "shift-2026-11-19",
  "tally": {
    "shiftId": "shift-2026-11-19",
    "open": 6,
    "closed": 2,
    "linked": 1,
    "total": 9
  },
  "rpcSurface": ["tally", "onCallStart", "onTranscription", "onCallHangup", "onJobReference"]
}
```

### Status codes

| Code | Body | When |
|---|---|---|
| 200 | shape above | Valid shift id (or default) |
| 400 | `{ "error": "invalid_shift_id" }` | `shift` fails the `shift-YYYY-MM-DD` pattern |
| 500 | `{ "error": "internal_error" }` | Unhandled exception |

---

## Catch-all

| Code | Body | When |
|---|---|---|
| 404 | `{ "error": "not_found" }` | Any method/path not matched above |

---

## Actor RPC surface

The `DispatchLine` actor (`env.DISPATCH.idFromName(shiftId)`) exposes these
public async methods. They are reachable via `agent.stub.<method>(...)` and
are listed by `rpcSurface()` in the `/tally` response.

| Method | Signature | Returns |
|---|---|---|
| `tally` | `(shiftId?: string) => Promise<Tally>` | `{ shiftId, open, closed, linked, total }` from SQL; defaults to the actor's shift |
| `onCallStart` | `(callId: string, shiftId: string)` | `{ shiftId, transcription }` — answers leg, starts transcription |
| `onTranscription` | `(segment: TranscriptionSegment)` | `{ filed, linked, seq }` — files a job row, speaks confirmation |
| `confirmOverCall` | `(callId: string, job: ParsedJob)` | `{ line, status }` — speaks the read-back on the leg |
| `onCallHangup` | `(callId: string)` | `{ stopped, tally }` — stops transcription, returns tally |
| `onJobReference` | `(text: string, callId: string, seq: number)` | `JobRow \| null` — links a note to an open job; a completion cue also closes it (`closed: true` on the row) |
| `shiftState` | `() => Promise<ShiftState>` | the actor's durable state (counters, active calls) — resume/proof surface |

### `Tally`

| Field | Type | Description |
|---|---|---|
| `shiftId` | string | Shift identifier |
| `open` | number | Rows with `status = 'open'` |
| `closed` | number | Rows with `status = 'closed'` |
| `linked` | number | Rows with `status = 'linked'` |
| `total` | number | Sum of the three |

---

## `shift_log` row shape

Every `call.transcription` webhook that yields a job phrase appends exactly one
row, idempotent on `(shift_id, seq)`.

| Column | Type | Notes |
|---|---|---|
| `shift_id` | TEXT | `shift-YYYY-MM-DD` |
| `seq` | INTEGER | Segment sequence; PK with `shift_id` |
| `job_text` | TEXT | Parsed job, e.g. `actuator swap` |
| `site` | TEXT | Parsed site, e.g. `north yard door 3` |
| `status` | TEXT | `open` \| `closed` \| `linked` (CHECK constraint) |
| `created_at` | TIMESTAMPTZ | Insert time |
| `source_call_id` | TEXT | `call_control_id` that produced the row |
