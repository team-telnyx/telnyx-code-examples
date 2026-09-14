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

### `POST /jobs`

Starts a new orchestration job. The orchestrator actor is created (or resumed) by `jobId`, reads the audio file list from the `MOCK_AUDIO_URLS` env var, spawns one `TranscriberAgent` child actor per file, and schedules a stuck-child check at 5 minutes.

#### Request Body

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `jobId`  | string | Yes      | Unique identifier for the job. Used as the actor name (must be URL-safe). |

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

Returned when the job cannot be started (e.g., `MOCK_AUDIO_URLS` is empty, or the actor is already in a non-`CREATED` state).

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

```json
{
  "jobId": "batch-transcription-job-42",
  "totalFiles": 5,
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
      "error": null
    }
  ],
  "status": "COMPLETED",
  "results": [
    {
      "fileId": "file-1",
      "transcript": "[demo] Mock transcript for file-1 from https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      "childName": "batch-transcription-job-42-file-1",
      "completedAt": "2026-07-28T12:00:05.000Z"
    }
  ],
  "createdAt": "2026-07-28T12:00:00.000Z",
  "completedAt": "2026-07-28T12:00:10.000Z"
}
```

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

### `OrchestratorAgent.startJob(payload: { jobId: string }): Promise<{ jobId: string }>`

Called by the HTTP handler via `env.ORCHESTRATOR.idFromName(jobId)` + `.get(id)` + `.startJob(...)`. Spawns children, transitions state `CREATED → SPAWNING → RUNNING`, schedules `checkChildren`.

### `OrchestratorAgent.reportComplete(fileId: string, transcript: string): Promise<void>`

Called by a child via `env.PARENT.idFromName(parentName).reportComplete(...)`. Marks the child `COMPLETED`, persists the per-file result to KV, and triggers `finalize` when all children have reported.

### `OrchestratorAgent.reportFailure(fileId: string, error: string): Promise<void>`

Called by a child via `env.PARENT.idFromName(parentName).reportFailure(...)`. Marks the child `FAILED`, persists the error to KV, and triggers `finalize` when all children have reported.

### `OrchestratorAgent.checkChildren(): Promise<void>`

Scheduled via `schedule(300, "checkChildren")`. Marks any child still `RUNNING` after 5 minutes as `FAILED` with error `"Timed out after 5 minutes"`.

### `OrchestratorAgent.finalize(): Promise<void>`

Queued via `queue(0, "finalize")` when all children have reported. Sets final status (`COMPLETED` or `PARTIAL_FAILURE`), persists full job state to KV, sends operator SMS (demo mode logs instead), then calls `this.destroy()`.

### `TranscriberAgent.assign(payload: { audioUrl: string; fileId: string; parentName: string }): Promise<void>`

Called by the parent via `child.assign(...)`. Sets child state to `RUNNING`, performs transcription (mock in demo mode, LLM call in live mode), then reports back to the parent via the `PARENT` binding.

---

## Environment Variables

| Variable            | Type    | Required | Description |
|---------------------|---------|----------|-------------|
| `DEMO_MODE`         | string  | No       | `"true"` (default) logs SMS and uses mock transcripts. Set to `"false"` for live mode. |
| `MOCK_AUDIO_URLS`   | string  | Yes      | Comma-separated list of public audio file URLs (one child spawned per entry). |
| `TELNYX_API_KEY`    | string  | Live only | Telnyx API key for LLM calls in live mode. |
| `OPERATOR_NUMBER`   | string  | Live only | Destination phone number for SMS notification. |
| `TELNYX_SENDER`     | string  | Live only | Sender phone number for SMS notification. |
