# Guide: Sub-Agent Orchestrator with Persistent Actors

## Overview

This sample demonstrates the **persistent actor orchestration** pattern on Telnyx Edge Runtime 0.15.2. The core concept: **the Actor IS the workflow**. A parent actor (`OrchestratorAgent`) spawns child actors (`TranscriberAgent`) for parallel jobs, tracks each child's lifecycle, persists results, and self-cleans on completion.

The parent actor survives across child lifecycles — it is the **durable orchestrator**, not a function call. This is the key architectural shift in edge-runtime 0.15.2: actors can spawn other actors, and the parent-child hierarchy persists across individual child crashes.

And because every child persists its per-file outcome to KV **before** reporting to the parent, the workflow is **resumable**: re-posting the same job after a crash adopts what finished and re-spawns only the workers that never reported — never redoing finished work.

## What You'll Build

A batch transcription orchestrator that:

1. Accepts a job request via `POST /jobs` (idempotent — safe to re-post)
2. Spawns one child actor per audio file (from `MOCK_AUDIO_URLS`)
3. Each child transcribes its file independently (mock in demo mode, real speech-to-text in live mode) and **persists its outcome to KV first**
4. Children report results back to the parent via typed RPC
5. Parent re-derives progress from KV, and re-spawns only workers that never reported (bounded by `MAX_CHILD_ATTEMPTS`)
6. Parent compiles an honest per-file scorecard, notifies via SMS
7. Parent self-destructs (cleans up all children) when done; re-posts return `ALREADY_DONE`

---

## Prerequisites

- Node.js 18+ (for local development)
- A Telnyx account with:
  - An API key (`TELNYX_API_KEY`)
  - A messaging sender ID (`TELNYX_SENDER`) — for live SMS
  - An operator phone number (`OPERATOR_NUMBER`) — for live SMS
- `@telnyx/edge-runtime` ^0.15.2 (NOT 0.15.0 or 0.15.1 — 0.15.0 shipped missing a file and fails at bundle time)

---

## Environment Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELNYX_API_KEY` | Your Telnyx API key (transcription + SMS REST calls in live mode) | `your_telnyx_api_key_here` |
| `OPERATOR_NUMBER` | Phone number to receive SMS notifications | `+1555XXXXXXXX` |
| `TELNYX_SENDER` | Telnyx number that sends SMS | `+1555XXXXXXXX` |
| `DEMO_MODE` | Set to `true` to skip real API calls | `true` |
| `MOCK_AUDIO_URLS` | Comma-separated list of audio file URLs | 5 public-domain speech clips |
| `STUCK_TIMEOUT_SECONDS` | Watchdog window before a running child counts as never-reported | `300` |
| `MAX_CHILD_ATTEMPTS` | Max re-spawn attempts per file before it is left `FAILED` | `3` |
| `DEMO_HANG_FILES` | Demo fault injection: file ids whose workers crash mid-run | empty |
| `DEMO_HANG_MS` | How long a hung demo worker stays down before crashing | `8000` |
| `DEMO_DELAY_MS` | Per-file pacing in demo mode (0 = instant; ≈2500 makes live progress watchable) | `0` |

> **Note on the deployed runtime:** `[env_vars]` in `telnyx.toml` may not reach the deployed
> function in current CLI versions — the code falls back to built-in defaults (the five
> verified speech clips, demo mode on, 300s watchdog) so the deployed app works out of the
> box. The UIs additionally pin `demoMode: true` and a 6-second watchdog per job for demo
> tempo, so behavior is deterministic on any host. The child resolves its parent through the
> `PARENT` actor binding, which must stay declared in `telnyx.toml`.
| `TRANSCRIPTION_MODEL` | Speech-to-text model for live transcription | `distil-whisper/distil-large-v2` |

### 3. Configure `telnyx.toml`

The `telnyx.toml` file declares your actor bindings:

```toml
name = "sub-agent-orchestrator-actor"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "ORCHESTRATOR"
type    = "OrchestratorAgent"

[[actors]]
binding = "TRANSCRIBER"
type    = "TranscriberAgent"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "OPERATOR_NUMBER"
name    = "OPERATOR_NUMBER"

[[secrets]]
binding = "TELNYX_SENDER"
name    = "TELNYX_SENDER"

[storage.kv.JOB_KV]
id = "<kv-namespace-uuid>"

[env_vars]
MOCK_AUDIO_URLS = "https://upload.wikimedia.org/wikipedia/commons/b/bb/Neil_Armstrong_small_step.wav,https://upload.wikimedia.org/wikipedia/commons/6/6d/Address_to_the_Nation_Excerpt.ogg,https://upload.wikimedia.org/wikipedia/commons/4/40/Portion_of_a_speech_by_Harding.ogg,https://upload.wikimedia.org/wikipedia/commons/f/f7/Speech_Prosody_audio_example.wav,https://upload.wikimedia.org/wikipedia/commons/a/a5/Booker_T._Washington_reading_an_excerpt_from_his_1895_Atlanta_Compromise_speech.mp3"
STUCK_TIMEOUT_SECONDS = "300"
MAX_CHILD_ATTEMPTS = "3"
DEMO_HANG_FILES = ""
DEMO_HANG_MS = "8000"
```

> **Note**: Replace `<kv-namespace-uuid>` with your actual KV namespace ID. You can create one via the Telnyx portal or CLI.

### 4. Generate types

```bash
npx telnyx-edge types
```

This generates `telnyx-env.d.ts` with type definitions for your bindings.

---

## Running the Sample

### Local Development

```bash
npm run dev
```

This starts the edge runtime locally. Open the service at `http://localhost:8787/` (or your local port): the clinic front door walks the use case end to end — start the nightly batch with a consult marked as "on the fault circuit", watch the power event hit and the service recover automatically, then read the morning report. The engineering view (actors, attempts, KV) is at `/console`. The HTTP entry point handles:

- `GET /` — the clinic front door
- `GET /console` — the engineering console
- `GET /config` — non-secret knobs for the console
- `POST /jobs` — start / resume / no-op (idempotent; accepts optional `audioUrls` and `hangFiles`)
- `GET /api/jobs/:jobId` — read the job record (mid-run snapshots included)

### Deploy to Telnyx Edge

```bash
npm run deploy
```

This runs `telnyx-edge ship` to deploy your actors.

---

## How It Works — Step by Step

### 1. HTTP Entry Point

The default export handles incoming HTTP requests. Two routes:

- **`POST /jobs`** — creates a job by looking up the orchestrator actor stub and calling `startJob()`
- **`GET /api/jobs/:jobId`** — reads job state from KV

```typescript
// POST /jobs
const id = env.ORCHESTRATOR.idFromName(body.jobId);
const stub = env.ORCHESTRATOR.get(id);
await stub.startJob({ jobId: body.jobId });
```

The actor is addressed by name (`idFromName`), which makes it **durable** — the same job ID always resolves to the same actor instance.

### 2. OrchestratorAgent — The Durable Workflow

The `OrchestratorAgent` class extends `Agent` and owns the entire job lifecycle. Its state shape tracks:

- `jobId` — unique job identifier
- `totalFiles` / `completed` / `failed` — progress counters
- `children` — array of `ChildState` objects
- `status` — the state machine position
- `results` — accumulated transcripts

```typescript
export class OrchestratorAgent extends Agent<OrchestratorEnv, OrchestratorState> {
  protected initialState(): OrchestratorState {
    return {
      jobId: "",
      totalFiles: 0,
      completed: 0,
      failed: 0,
      children: [],
      status: "CREATED",
      results: [],
      createdAt: nowIso(),
      completedAt: null,
    };
  }
```

### 3. Starting a Job — `startJob()`

`startJob()` is **idempotent**. When the HTTP handler calls it, the orchestrator decides by evidence:

1. If the job finished before (full record in KV) → return `ALREADY_DONE`; finished work is never redone — even after `destroy()` wiped actor state.
2. If the job is already active → run `reconcile()` and return `RESUMED`.
3. Otherwise (fresh) → read `MOCK_AUDIO_URLS`, pin the file list in state, transition to `SPAWNING`, then reconcile: **spawn one child actor per audio file**:

```typescript
const child = await this.spawn(this.env.TRANSCRIBER, childName);
// fire and forget — children run in parallel; the KV record is the authority
child.assign({ audioUrl: urls[i], fileId, jobId, parentName: this.ctx.id, attempt });
```

4. Records the attempt ledger in KV (`job:{jobId}:attempt:{fileId}`) before each spawn
5. Transitions to `RUNNING`
6. Arms the stuck-child watchdog: `await this.schedule(STUCK_TIMEOUT_SECONDS, "checkChildren", undefined, { id: `${jobId}:watchdog` })` — the stable id means re-posts re-arm the same timer instead of stacking new ones

### 4. Child Actor — `TranscriberAgent`

Each child is itself a persistent actor with its own state (`TranscriberState`). When the parent calls `assign()`, the child:

1. Stores the payload (audio URL, file ID, job ID, parent name, attempt number)
2. Transitions to `RUNNING`
3. Calls `transcribeAudio()` — either mock (demo mode) or a real speech-to-text call to `/v2/ai/audio/transcriptions`
4. **KV-first:** on success, persists the per-file outcome to KV *before* reporting; on failure, persists the `FAILED` record the same way
5. Reports back to the parent via typed RPC (`reportComplete` / `reportFailure`) — best-effort, because the KV record already carries the truth

**Key pattern — child→parent communication:**

There is no built-in parent handle on the child. The child reaches the parent via its own env binding:

```typescript
interface TranscriberEnv {
  SECRETS: Secrets;
  PARENT: ActorNamespace<OrchestratorAgent>;  // binding to OrchestratorAgent
  JOB_KV: KvNamespace;                        // shared KV for per-file records
}
```

The parent's routing name is passed in the `assign()` payload:

```typescript
const parent = this.env.PARENT.idFromName(payload.parentName);
await parent.reportComplete(payload.fileId, transcript, payload.attempt);
```

### 5. KV Is the Source of Truth

The parent never trusts in-memory bookkeeping over durable evidence. Three KV key families carry the truth:

- `job:{jobId}:file:{fileId}` — per-file outcome, **written by the child before reporting** (status, transcript/error, attempts, childName)
- `job:{jobId}:attempt:{fileId}` — attempt ledger, **written by the parent before each spawn** (attempt number + start time) — scalar writes converge under concurrency
- `job:{jobId}` — the full job record + scorecard, written once at finalize; it survives `destroy()` and powers the `ALREADY_DONE` no-op

`reconcile()` re-derives the child ledger, results, and counters from these records on every pass — so concurrent reconciles converge instead of clobbering each other, and any crash is recoverable from KV alone.

### 6. Resumability — `reconcile()`

The recovery loop, for every file in the pinned list:

1. KV record `COMPLETED` → adopt; the file is never re-run
2. Worker `RUNNING` and recent (and still listed by `this.children()`) → in flight, leave it alone
3. No record / stale record / failed / stuck → `despawn()` the old worker and spawn a fresh one with a `-rN` name
4. Attempts exhausted (`MAX_CHILD_ATTEMPTS`) → leave `FAILED` for the honest scorecard

The 3am scenario: a power event kills the batch mid-run. Some children persisted their records; some never got to. When power returns, the operator re-posts the same `POST /jobs` request. The parent adopts every finished file from KV (attempts stay 1 — no duplicate billing), re-spawns only the lost workers, and finishes with a scorecard that says exactly what succeeded, what failed, and why.

### 7. Stuck-Child Detection — `schedule()`

When the job starts (and after every reconcile), the parent arms a watchdog with a stable id:

```typescript
await this.schedule(STUCK_TIMEOUT_SECONDS, "checkChildren", undefined, {
  id: `${jobId}:watchdog`,
});
```

`checkChildren()` runs `reconcile()`, which treats any worker still `RUNNING` past the window as never-reported — re-spawning it (if attempts remain) or leaving it `FAILED` (if exhausted):

```typescript
async checkChildren(): Promise<void> {
  const state = await this.getState();
  if (state.status !== "RUNNING" && state.status !== "SPAWNING") return;
  await this.reconcile();
}
```

### 8. Finalizing — `finalize()`

When all files are resolved (every file has a KV `COMPLETED` record, or its latest attempt is exhausted), the parent:

1. Transitions to `COMPLETING`
2. Queues `finalize()` with a stable id (dedupes across crashes):

```typescript
await this.queue("finalize", undefined, { id: `${jobId}:finalize` });
```

3. In `finalize()`:
   - Re-derives the child ledger from KV and builds the honest per-file **scorecard** (`outcomes`: status, error reason, attempt counts)
   - Determines final status (`COMPLETED` or `PARTIAL_FAILURE`)
   - Persists the full job record to KV
   - Sends the SMS notification with the scorecard summary (demo mode logs instead)
   - **Self-destructs**:

```typescript
await this.setState({ status: "CLEANING_UP" });
await this.destroy();
```

### 9. `destroy()` — Lifecycle Exit

`destroy()` is the actor's lifecycle exit. Per 0.15.2 docs, it "empties state, timers, history, events, clients — the instance remains but is clean."

This means:
- All child actors are cleaned up
- Timers are cancelled
- State is emptied
- The instance persists as an empty shell (re-activatable)

This is the designed lifecycle exit — not a manual cleanup step.

---

## State Machine

```
CREATED → SPAWNING → RUNNING → COMPLETING → COMPLETED → CLEANING_UP → (destroyed)
                              ↘ COMPLETING → PARTIAL_FAILURE → CLEANING_UP → (destroyed)
```

Transitions:
- `CREATED` → `SPAWNING`: `startJob()` begins
- `SPAWNING` → `RUNNING`: reconciliation starts spawning workers (children can report from here on)
- `RUNNING` → `RUNNING`: reconciles adopt finished files and re-spawn lost workers (bounded)
- `RUNNING` → `COMPLETING`: every file resolved (success or exhausted failure)
- `COMPLETING` → `COMPLETED`: zero failures
- `COMPLETING` → `PARTIAL_FAILURE`: some files failed after all attempts
- `COMPLETED` / `PARTIAL_FAILURE` → `CLEANING_UP`: `finalize()` calls `destroy()`
- Re-post of an active job → `RESUMED` (reconcile runs, status unchanged)
- Re-post of a finished job → `ALREADY_DONE` (no transition; KV record returned)

---

## Demo Mode vs Live Mode

### Demo Mode (default)

Set `DEMO_MODE=true` in your environment. In demo mode:

- **Transcription**: Returns a mock transcript: `[demo] Mock transcript for {fileId} from {audioUrl}`
- **SMS**: Logs to console instead of sending: `[demo] SMS to operator: {message}`
- **Fault injection**: pass `hangOnce` in the `POST /jobs` body for the one-shot power-event story (first attempt crashes, the re-spawned worker succeeds — the batch recovers automatically), or `hangFiles`/`DEMO_HANG_FILES` for persistent faults (every attempt crashes — the exhaustion path). Set `STUCK_TIMEOUT_SECONDS=1` to watch the watchdog mark the stuck worker, re-spawn it (`-r2`), and ship the scorecard in seconds — or just tick the fault toggles in the clinic page.

This is safe — no real API calls, no charges.

### Live Mode

Set `DEMO_MODE=false` and configure:

- `TELNYX_API_KEY` — for the transcription and SMS calls
- `OPERATOR_NUMBER` — where SMS notifications go
- `TELNYX_SENDER` — the Telnyx number that sends SMS

In live mode:

- **Transcription**: Makes a real speech-to-text call to `https://api.telnyx.com/v2/ai/audio/transcriptions` with your API key
- **SMS**: Sends real SMS via `this.env.TELNYX.messages.send()`

---

## Telnyx Primitives Used

| Primitive | Usage |
|-----------|-------|
| `Agent` | Base class for both `OrchestratorAgent` and `TranscriberAgent` |
| `spawn()` | Parent creates child actors: `this.spawn(this.env.TRANSCRIBER, name)` — parallel, fire-and-forget |
| `children()` | `reconcile()` cross-checks the platform's live children against its own bookkeeping |
| `despawn()` | Retires a failed/stuck worker before re-spawning a fresh one (idempotent by design) |
| `destroy()` | Clean up all children + self in one call |
| `schedule()` | Stuck-child watchdog with a stable id (`${jobId}:watchdog`) — re-armed by every reconcile, never stacked |
| `queue()` | Resolution → `finalize()` with a stable id (`${jobId}:finalize`) — deduped across crashes |
| KV (per-file) | `job:{jobId}:file:{fileId}` — outcome records written by children, KV-first |
| KV (attempt ledger) | `job:{jobId}:attempt:{fileId}` — scalar ledger written by the parent before each spawn |
| SMS | Operator notification via `POST /v2/messages` (raw REST, key from SECRETS) |
| Transcription | Real speech-to-text via `POST /v2/ai/audio/transcriptions` (raw REST, `file_url` + `model`) |

---

## API Reference

### `POST /jobs`

Idempotent — start, resume, or no-op. Re-posting the same `jobId` resumes an interrupted run (adopting finished files from KV) or returns the finished record untouched.

**Request body:**
```json
{
  "jobId": "batch-transcription-job-42"
}
```

**Response:**
```json
{
  "jobId": "batch-transcription-job-42",
  "status": "STARTED"
}
```

`status` is `"STARTED"` (fresh), `"RESUMED"` (recovered), or `"ALREADY_DONE"` (finished — never redone).

### `GET /api/jobs/:jobId`

Read the full job record, including the per-file scorecard (`outcomes`).

**Response:**
```json
{
  "jobId": "batch-transcription-job-42",
  "totalFiles": 5,
  "audioUrls": ["https://upload.wikimedia.org/wikipedia/commons/b/bb/Neil_Armstrong_small_step.wav"],
  "completed": 5,
  "failed": 0,
  "children": [
    {
      "name": "batch-transcription-job-42-file-1",
      "type": "Transcriber",
      "fileId": "file-1",
      "status": "COMPLETED",
      "startedAt": "2026-07-28T12:00:00.000Z",
      "completedAt": "2026-07-28T12:00:05.000Z",
      "error": null,
      "attempts": 1
    }
  ],
  "status": "COMPLETED",
  "results": [
    {
      "fileId": "file-1",
      "transcript": "[demo] Mock transcript for file-1 from https://...",
      "childName": "batch-transcription-job-42-file-1",
      "attempts": 1,
      "completedAt": "2026-07-28T12:00:05.000Z"
    }
  ],
  "outcomes": [
    {
      "fileId": "file-1",
      "status": "COMPLETED",
      "transcript": "[demo] Mock transcript for file-1 from https://...",
      "error": null,
      "attempts": 1,
      "childName": "batch-transcription-job-42-file-1"
    }
  ],
  "createdAt": "2026-07-28T12:00:00.000Z",
  "completedAt": "2026-07-28T12:00:05.000Z"
}
```

---

## Troubleshooting

### "TELNYX_API_KEY secret not configured"

Set the secret via CLI:

```bash
telnyx-edge secrets add TELNYX_API_KEY "your-key-here"
```

### "MOCK_AUDIO_URLS env var is empty"

Ensure `MOCK_AUDIO_URLS` is set in `telnyx.toml` under `[env_vars]` or in your local `.env.local`.

### Re-posting a job returns `ALREADY_DONE` but you expected a re-run

The job finished previously and KV is the authority — finished work is never redone by design. Use a new `jobId` for a fresh run.

### A file stays `FAILED` in the scorecard

Read `outcomes[].error` in the `GET /api/jobs/:jobId` response — it carries the last failure reason and the attempt count. Raise `MAX_CHILD_ATTEMPTS` or fix the underlying failure (bad URL, rate limit, transcription error) and re-post: exhausted files are re-attempted by reconcile.

### Job stuck in `SPAWNING`

Check that the `TRANSCRIBER` actor binding is correctly configured in `telnyx.toml`. The child actor class must be exported from `src/index.ts`.

### Children not reporting back

Verify the `PARENT` binding on the `TranscriberAgent` is correctly typed. The parent's routing name must match the actor name used in `idFromName()`. Even a lost report RPC is not fatal: the child's KV record carries the truth and the next `reconcile()` adopts it.

---

## Next Steps

- **Explore the Agent SDK**: [Agent SDK documentation](https://developers.telnyx.com/docs/edge/agent-sdk)
- **Learn about actor spawning**: [Actor lifecycle documentation](https://developers.telnyx.com/docs/edge/actors)
- **Try the Telnyx AI API**: [AI API reference](https://developers.telnyx.com/docs/ai)
- **Build your own orchestrator**: Use this pattern for any parallel job workflow — data processing, fan-out/fan-in, batch operations

---

## Related Examples

- [Stateful Actor with KV](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge/stateful-actor-kv)
- [Scheduled Tasks with Agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge/scheduled-agent)
- [SMS Notifications with Agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge/sms-agent)
