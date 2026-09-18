# API Reference — Sub-Agent Orchestrator Actor

This document is the typed API contract for the `sub-agent-orchestrator-actor` sample. It covers the HTTP routes exposed by the edge runtime entry point and the actor RPC methods callable between actors.

Base URL: `https://<your-deployment>.telnyx-edge.com`

All responses are JSON. Error responses follow the shape:

```json
{
  "error": "Human-readable error message"
}
```

---

## Routes

### `GET /`

The clinic-facing front door (single-page HTML, no dependencies): tonight's batch of consult recordings, the 3am power-event simulation, live per-recording progress, the "power returned" re-check, and the morning report with the operator SMS.

### `GET /console`

The engineering console (single-page HTML): actor names, attempt counts, KV keys, `STARTED`/`RESUMED`/`ALREADY_DONE` badges — the orchestration internals behind the front door.

### `GET /config`

Non-secret configuration for the console.

#### Response — `200 OK`

```json
{
  "audioUrls": ["https://upload.wikimedia.org/..."],
  "transcriptionModel": "distil-whisper/distil-large-v2",
  "stuckTimeoutSeconds": 300,
  "maxAttempts": 3,
  "demoMode": true
}
```

### `POST /jobs`

Starts a new orchestration job — **and is idempotent**, which is the recovery story of this sample:

| Situation | Behavior | `status` in response |
|-----------|----------|----------------------|
| `jobId` never seen | Fresh start: spawns one `TranscriberAgent` child per file, schedules the stuck-child watchdog | `"STARTED"` |
| `jobId` seen, run still active | **Resume**: adopts finished files from KV, re-spawns only workers that never reported (bounded by `MAX_CHILD_ATTEMPTS`) | `"RESUMED"` |
| `jobId` seen, job finished | No-op: the KV record is authoritative — finished work is **never redone**, even after the parent actor destroyed itself | `"ALREADY_DONE"` |

The orchestrator actor is addressed by `jobId` (`idFromName`), so the same job ID always resolves to the same actor instance.

#### Request Body

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `jobId`  | string | Yes      | Unique identifier for the job. Used as the actor name (must be URL-safe). |
| `audioUrls` | string[] | No | Overrides `MOCK_AUDIO_URLS` for this job (max 12, http/https URLs). |
| `hangFiles` | string[] | No | Workers for these files crash on EVERY attempt (overrides `DEMO_HANG_FILES`). |
| `hangOnce` | string[] | No | One-shot power event: only the first attempt crashes; the re-spawned worker succeeds. |
| `stuckTimeoutSeconds` | number | No | Per-job watchdog window (overrides the env default). The UIs pass 6 for demo tempo. |
| `demoMode` | boolean | No | Job-level demo pin: mock transcripts + logged SMS when `true`, regardless of env. |

#### Example Request

```bash
curl -X POST https://<your-deployment>.telnyx.com/jobs \
  -H "Content-Type: application/json" \
  -d '{"jobId": "batch-transcription-job-42"}'
```

#### Response — `200 OK`

```json
{
  "jobId": "batch-transcription-job-42",
  "status": "STARTED"
}
```

`status` is one of `"STARTED"`, `"RESUMED"`, or `"ALREADY_DONE"` (see the table above).

#### Response — `400 Bad Request`

Returned when the request body is missing or `jobId` is absent/not a string.

```json
{
  "error": "jobId is required"
}
```

```json
{
  "error": "Invalid JSON body"
}
```

#### Response — `500 Internal Server Error`

Returned when the job cannot be started (e.g., `MOCK_AUDIO_URLS` is empty, or the actor instance is bound to a different `jobId`).

```json
{
  "error": "MOCK_AUDIO_URLS env var is empty — cannot start job"
}
```

---

### 2. `GET /api/jobs/:jobId`

Returns the full persisted job state from KV, including the orchestrator state machine status, per-child states, and compiled transcript results.

#### Path Parameters

| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `jobId` | string | Yes      | The job ID passed to `POST /jobs`. |

#### Example Request

```bash
curl http://<your.example>.telnyx.com/api/jobs/batch-transcription-job-42
```

#### Response — `200 OK`

The persisted job record, including the per-file **scorecard** (`outcomes`), per-child ledger (`children`), and transcript results (`results`).

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
      "transcript": "[demo] Mock transcript for file-1 from https://upload.wikimedia.org/wikipedia/commons/b/bb/Neil_Armstrong_small_step.wav",
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
  "completedAt": "2026-07-28T12:00:10.000Z"
}
```

Notes:

- `status` is `COMPLETED` or `PARTIAL_FAILURE` once the job finalizes. Mid-run, `reconcile()` persists a derived snapshot to the same key, so the record exists (with `RUNNING` status) while workers are in flight; finalize overwrites it with the full record.
- `outcomes[].attempts` shows how many worker attempts each file consumed — the honest part of the scorecard.
- Re-spawned workers appear as `…-file-N-r2`, `-r3`, etc. in `children[].name`.
- `notification` is the exact SMS text sent to the operator (null until finalize).
- `incidents` is the timeline of worker replacements (fileId, attempt, reason, at) — the "what went wrong and how it recovered" story, derived from per-incident KV records.

#### Response — `404 Not Found`

Returned when no job state exists in KV for the given `jobId`.

```json
{
  "error": "Job not found"
}
```

---

## Status Codes

| Status Code | Description |
|-------------|-------------|
| `200 OK` | Request succeeded. |
| `400 Bad Request` | Invalid request body or missing required field. |
| `404 Not Found` | Job ID does not exist in KV, or route does not match. |
| `500 Internal Server Error` | Job could not be started (e.g., missing `MOCK_AUDIO_URLS`, job already started). |

---

## Actor RPCs (Internal)

These methods are not exposed over HTTP but are callable between actors via typed stubs.

### `OrchestratorAgent.startJob(payload: { jobId: string }): Promise<{ jobId: string; status: "STARTED" | "RESUMED" | "ALREADY_DONE" }>`

Called by the HTTP handler via `env.ORCHESTRATOR.idFromName(jobId)` + `.startJob(...)`. Fresh jobs spawn children and schedule the watchdog; re-posts reconcile/resume; finished jobs no-op with `ALREADY_DONE` (the KV record is authoritative, even after `destroy()`).

### `OrchestratorAgent.reconcile(): Promise<void>`

The recovery loop. Derives per-file truth from KV (per-file records + attempt ledger + the platform's live children via `children()`), adopts finished files, and re-spawns ONLY workers that never reported — despawning the old worker first (`despawn()`), with a fresh `-rN` name per attempt, bounded by `MAX_CHILD_ATTEMPTS`. Re-arms the watchdog with a stable schedule id.

### `OrchestratorAgent.reportComplete(fileId: string, transcript: string, attempt = 1): Promise<void>`

Called by a child via `env.PARENT.idFromName(parentName).reportComplete(...)` after the child has already persisted its per-file KV record (KV-first). The parent does not rewrite per-file records — it only runs the resolution check and finalizes when every file is resolved. Stale reports from replaced workers (attempt mismatch) are ignored.

### `OrchestratorAgent.reportFailure(fileId: string, error: string, attempt = 1): Promise<void>`

Called by a child via `env.PARENT.idFromName(parentName).reportFailure(...)` after the child persisted its `FAILED` record. Triggers `reconcile()` for prompt, bounded re-spawn. Stale reports from replaced workers are ignored.

### `OrchestratorAgent.checkChildren(): Promise<void>`

Scheduled via `schedule(seconds, "checkChildren", undefined, { id: "<jobId>:watchdog" })` with a stable id (re-armed by every reconcile, so re-posts don't stack timers). Treats children still `RUNNING` past `STUCK_TIMEOUT_SECONDS` as never-reported and runs `reconcile()`.

### `OrchestratorAgent.finalize(): Promise<void>`

Queued via `queue("finalize", undefined, { id: "<jobId>:finalize" })` when all files are resolved. Derives the honest per-file scorecard (`outcomes` with status, error reason, and attempt counts) from KV, persists the full job record to KV, sends the operator SMS (demo mode logs instead), then calls `this.destroy()`.

### `TranscriberAgent.assign(payload: { audioUrl: string; fileId: string; jobId: string; parentName: string; attempt: number; hangFiles?: string[] }): Promise<void>`

Called by the parent via `child.assign(...)`. Sets child state to `RUNNING`, performs transcription (mock in demo mode, real speech-to-text via `/v2/ai/audio/transcriptions` in live mode), **persists its per-file outcome to KV before reporting to the parent** (KV-first ordering), then reports back via the `PARENT` binding. Request-level `hangFiles` fault injection applies before transcription; the env-based `DEMO_HANG_FILES` only applies in demo mode.

---

## Environment Variables

| Variable              | Type    | Required | Description |
|-----------------------|---------|----------|-------------|
| `DEMO_MODE`           | string  | No       | `"true"` (default) logs SMS and uses mock transcripts. Set to `"false"` for live mode. |
| `TRANSCRIPTION_MODEL` | string  | No       | Speech-to-text model for live transcription (default `distil-whisper/distil-large-v2`). |
| `MOCK_AUDIO_URLS`     | string  | Yes      | Comma-separated list of public audio file URLs (one child spawned per entry). |
| `TELNYX_API_KEY`      | string  | Live only | Telnyx API key for the transcription call and the SMS REST call in live mode. |
| `OPERATOR_NUMBER`     | string  | Live only | Destination phone number for SMS notification. |
| `TELNYX_SENDER`       | string  | Live only | Sender phone number for SMS notification. |
| `STUCK_TIMEOUT_SECONDS` | string | No      | Watchdog window: children still `RUNNING` after this many seconds are treated as never-reported (default `300`). |
| `MAX_CHILD_ATTEMPTS`  | string  | No       | Max re-spawn attempts per file before it is left `FAILED` in the scorecard (default `3`). |
| `DEMO_HANG_FILES`     | string  | No       | Demo fault injection: comma-separated file ids (e.g. `file-2`) whose workers crash mid-run. Demo mode only. |
| `DEMO_HANG_MS`        | string  | No       | How long a `DEMO_HANG_FILES` worker stays hung before crashing (default `8000`). |
