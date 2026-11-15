---
name: dispatch-line
title: "The Dispatch Line — a shift log that writes itself mid-call"
description: "A durable per-shift actor that rides Telnyx in-call transcription, files job rows from live speech, and reads the confirmation back over the same leg before the call ends."
language: typescript
framework: edge
telnyx_products: [Voice API, In-Call Transcription, Programmable Voice, Agent SDK]
---

# The Dispatch Line — a shift log that writes itself mid-call

One durable actor per shift rides Telnyx in-call transcription: every job spoken on the line is filed into `shift_log` and read back over the same leg before the call is over.

## The Story

Ridgeline Door & Gate runs a regional field-service dispatch line out of a converted warehouse in Ohio — six trucks, one foreman driving between sites, and a dispatcher who takes every job by voice. When a job is misheard, a truck rolls to north yard door 2 instead of door 3, an hour burns, and a gate stays broken overnight; when a job is never written down at all, the work happens and nobody bills it. The shift log is the only artifact that outlives the day: what was asked for, where, and whether it got done. The actor IS the shift log. It is born the moment the first call of the shift is answered, it grows a row every time the foreman says a job out loud, it links the 3 p.m. callback about "that actuator from this morning" back to the row filed at 7:02, and it closes out with the day's tally — and when the pod running it is killed mid-shift, the next transcription segment wakes it with every job row still intact, nothing re-filed and nothing lost. The rest of this README is the API surface of that story.

## Why Telnyx

Because the log has to be written *while the truck is still rolling*, the sample needs a carrier that treats live call events and live transcript segments as first-class webhooks on the same leg the audio is on. Telnyx gives us that in one stack: **AI Communications Infrastructure** — Call Control to answer and speak, in-call Transcription streaming `call.transcription` segments as they are spoken (no post-call batch, no media download), and Programmable Voice TTS to read the confirmation back on the active leg. The Edge runtime's `Agent` class supplies the durable half: one actor per shift, agent state for the counters, SQL for the job rows, and an `@rpc` surface the dispatcher can query. No third-party STT vendor, no separate transcript pipeline, no glue service between the phone system and the database.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/calls/{call_control_id}/actions/answer` | Answer the inbound leg on `call.initiated` |
| `POST` | `/v2/calls/{call_control_id}/actions/transcription_start` | Start live in-call transcription (`transcriptions: [{language, engine_config}]`) |
| `POST` | `/v2/calls/{call_control_id}/actions/transcription_stop` | End the transcript window early / on hangup |
| `POST` | `/v2/calls/{call_control_id}/actions/speak` | Speak the confirmation line on the active leg |
| `POST` (inbound) | `/webhooks/telnyx` | Telnyx webhook receiver — `call.initiated`, `call.transcription`, `call.hangup` |

Webhook event types consumed: `call.initiated`, `call.transcription`, `call.hangup`.

## Architecture

```
                    Telnyx Voice Platform
   ┌──────────────────────────────────────────────────────────┐
   │  inbound call ──► answer ──► transcription_start         │
   │       │                          │                       │
   │       │        call.transcription segments (live)        │
   │       │                          │                       │
   │       └──────────┬───────────────┴───────────┐           │
   │                  │  webhooks (Ed25519 signed)│           │
   │                  │  call.hangup ──► stop     │           │
   └──────────────────┼───────────────────────────┼───────────┘
                      ▼                           │
        POST /webhooks/telnyx                     │
        GET  /tally                               │
                      │                           │
              ┌───────▼────────┐                  │
              │  fetch handler │  verifySignature │
              │  (src/index.ts)│  shiftIdFor()    │
              └───────┬────────┘                  │
                      │ env.DISPATCH.idFromName("shift-YYYY-MM-DD")
                      ▼                           │
        ┌─────────────────────────────────┐       │
        │  DispatchLine extends Agent     │       │
        │  state: { shiftId, openJobs,    │       │
        │           closedJobs, linked,   │       │
        │           lastSeq, activeCalls} │       │
        │                                 │       │
        │  onCallStart()                  │───────┘  answer + transcription_start
        │  onTranscription(segment)       │──────────► speak (confirmation line)
        │  onJobReference(text)           │
        │  onCallHangup(callId)           │──────────► transcription_stop
        │  @rpc tally()                   │
        └───────────┬─────────────────────┘
                    │
        ┌───────────▼──────────────┐      ┌──────────────────────────┐
        │  SHIFT_DB (SQL binding)  │      │  actor durable storage   │
        │  shift_log               │      │  transcript:<seq> blobs  │
        │  (shift_id, seq, ...)    │      │  message history         │
        └──────────────────────────┘      └──────────────────────────┘
```

Data flow, step by step:

1. `call.initiated` → `answer` the leg → `onCallStart()` → `transcription_start` on the leg → actor born at `shift-YYYY-MM-DD`.
2. `call.transcription` → `toSegment()` normalizes the payload → `onTranscription()` → `parseJob()` → one `shift_log` row (idempotent on `(shift_id, seq)`).
3. Job filed → `confirmOverCall()` → `speak` on the same leg: *"North yard, door 3, actuator swap — logged."*
4. Non-job segment with a reference cue ("that actuator from this morning") → `onJobReference()` → keyword match against open rows → `linked` row.
5. `call.hangup` → `transcription_stop` (skipped if the leg is already gone) → tally recomputed from SQL.
6. `GET /tally?shift=shift-2026-11-19` → `@rpc tally()` → counts straight from `shift_log`.

### `shift_log` schema

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
);
```

`seq` comes from `transcription_data.sequence` when Telnyx sends one, otherwise from a stable FNV-1a hash of the webhook event id — so a redelivered webhook resolves to the same `seq` and the insert is a true no-op.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

`DEMO_MODE` is an optional non-secret env var (default `"true"`). When `true`, every outbound Telnyx REST call is logged instead of sent, and signature verification is skipped with a warning if `TELNYX_PUBLIC_KEY` is unset. Set `DEMO_MODE=false` for live calls.

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/dispatch-line

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# edit .env and fill in TELNYX_API_KEY / TELNYX_PUBLIC_KEY

# 4. Authenticate the Edge CLI and push secrets
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "your_telnyx_public_key_here"

# 5. Generate binding types from telnyx.toml
telnyx-edge types

# 6. Run the smoke test (no network, no charges)
npx tsx smoke_test.ts

# 7. Deploy
telnyx-edge ship
```

Point a Telnyx Call Control application's webhook URL at `https://<your-actor-host>/webhooks/telnyx` and assign a phone number to it. Then dial the number — in demo mode you will see the `answer`, `transcription_start`, `speak`, and `transcription_stop` calls logged to the console instead of hitting the live API.

Query the shift log at any time:

```bash
curl "https://<your-actor-host>/tally?shift=shift-2026-11-19"
```

## API Reference

### `POST /webhooks/telnyx`

Telnyx webhook receiver. Verifies the Ed25519 signature over `${telnyx-timestamp}|${rawBody}` before parsing.

| Event type | Behavior |
|------------|----------|
| `call.initiated` | Answers the leg, calls `onCallStart(callId, shiftId)` → `transcription_start` |
| `call.transcription` | Normalizes the segment, calls `onTranscription(segment)` → parse / file / link / speak |
| `call.hangup` | Calls `onCallHangup(callId)` → `transcription_stop` (or `skipped`) + tally |

Responses: `200 {"ok": true, ...}`, `400 {"error": "invalid_json" | "missing_call_control_id"}`, `401 {"error": "invalid_signature"}`, `500 {"error": "internal_error"}`.

### `GET /tally?shift=shift-YYYY-MM-DD`

Returns the shift tally straight from SQL plus the actor's RPC surface.

```json
{
  "ok": true,
  "shiftId": "shift-2026-11-19",
  "tally": { "shiftId": "shift-2026-11-19", "open": 6, "closed": 2, "linked": 1, "total": 9 },
  "rpcSurface": ["tally", "onCallStart", "onTranscription", "onCallHangup", "onJobReference"]
}
```

`400 {"error": "invalid_shift_id"}` if the `shift` param does not match `shift-\d{4}-\d{2}-\d{2}`.

### Actor surface — `DispatchLine extends Agent<Env, ShiftState>`

| Method | Signature | Description |
|--------|-----------|-------------|
| `onCallStart` | `(callId: string, shiftId: string) => Promise<{shiftId, transcription}>` | Registers the active call, starts in-call transcription |
| `onTranscription` | `(segment: TranscriptionSegment) => Promise<{filed, linked, seq}>` | Persists the segment, files or links a job row, speaks the read-back |
| `confirmOverCall` | `(callId: string, job: ParsedJob) => Promise<{line, status}>` | `speak` the confirmation line on the active leg |
| `onJobReference` | `(text: string, callId: string, seq: number) => Promise<JobRow \| null>` | Keyword-matches a later note to an open job row |
| `onCallHangup` | `(callId: string) => Promise<{stopped, tally}>` | `transcription_stop` (or `skipped`), returns the tally |
| `tally` | `() => Promise<Tally>` | `@rpc` — open/closed/linked counts from `shift_log` |

### Transcription settings

```json
{
  "transcriptions": [
    { "language": "en", "engine_config": { "engine": "telnyx" } }
  ]
}
```

Segments arrive on the `call.transcription` webhook. The sample reads transcript text from `payload.transcript` and falls back to `payload.transcription_data.transcript`; `transcription_data.is_final` gates the write, and `transcription_data.sequence` (when present) supplies `seq`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 invalid_signature` on every webhook | `TELNYX_PUBLIC_KEY` missing or wrong, or a proxy rewrote the body | Set the public key from the Telnyx portal; verify the raw body is unmodified |
| No `call.transcription` events arrive | Transcription never started, or the Call Control app has no webhook URL | Check the `transcription_start` response in the logs; confirm the app's webhook URL points at `/webhooks/telnyx` |
| Jobs are filed twice | `seq` is not stable across redeliveries | Confirm `transcription_data.sequence` is present; otherwise the FNV-1a hash of the event id keeps `seq` deterministic |
| `speak` returns `error:422` | The leg already hung up | Expected — the confirmation is best-effort; the row is already durable |
| `tally` returns all zeros | Querying a different `shift` than the one the calls landed on | Use the `shiftId` echoed in the webhook response |
| `transcription_stop` returns `skipped` | The leg was already gone at hangup | Correct behavior — no orphaned transcript session is created |
| Actor state resets after a deploy | You are reading counters from memory instead of `getState()` | All counters go through `getState()` / `setState()`; `shift_log` is the source of truth for `tally()` |

## Agent Discovery

- Agent signup and onboarding: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- Telnyx AI agent examples: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- Machine-readable docs index: [developers.telnyx.com/llms.txt](https://developers.telnyx.com/llms.txt)

## Related Examples

- **Live Compliance Captions** (`live-compliance-captions`) — standalone STT WebSocket over recorded files; a different transcription surface from the `call.transcription` webhook used here.
- **AI Dispatch Service** — the jobs/flagship pattern this sample derives from, rebuilt on Telnyx-native primitives.
- **Call Control Answer + Speak** — the minimal voice leg lifecycle this sample builds on.
- **Agent SDK Stateful Actor** — the `Agent` / `@rpc` / SQL binding patterns used by `DispatchLine`.

## Resources

- [Speech-to-Text with Voice API and TeXML](https://developers.telnyx.com/docs/voice/programmable-voice/speech-to-text)
- [Transcription start — API reference](https://developers.telnyx.com/api-reference/call-commands/transcription-start)
- [Transcription callback — API reference](https://developers.telnyx.com/api-reference/callbacks/transcription)
- [Transcription stop — API reference](https://developers.telnyx.com/api-reference/call-commands/transcription-stop)
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Voice API product page](https://telnyx.com/products/voice-api)
- [Telnyx pricing](https://telnyx.com/pricing)
