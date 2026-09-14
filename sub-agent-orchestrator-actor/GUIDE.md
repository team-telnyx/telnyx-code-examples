# Guide: Sub-Agent Orchestrator with Persistent Actors

## Overview

This sample demonstrates the **persistent actor orchestration** pattern on Telnyx Edge Runtime 0.15.2. The core concept: **the Actor IS the workflow**. A parent actor (`OrchestratorAgent`) spawns child actors (`TranscriberAgent`) for parallel jobs, tracks each child's lifecycle, persists results, and self-cleans on completion.

The parent actor survives across child lifecycles — it is the **durable orchestrator**, not a function call. This is the key architectural shift in edge-runtime 0.15.2: actors can spawn other actors, and the parent-child hierarchy persists across individual child crashes.

## What You'll Build

A batch transcription orchestrator that:

1. Accepts a job request via `POST /jobs`
2. Spawns one child actor per audio file (from `MOCK_AUDIO_URLS`)
3. Each child transcribes its file independently (mock or real LLM)
4. Children report results back to the parent via typed RPC
5. Parent accumulates results, persists to KV, and notifies via SMS
6. Parent self-destructs (cleans up all children) when done

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
| `TELNYX_API_KEY` | Your Telnyx API key | `your_telnyx_api_key_here` |
| `OPERATOR_NUMBER` | Phone number to receive SMS notifications | `+1555XXXXXXXX` |
| `TELNYX_SENDER` | Telnyx number that sends SMS | `+1555XXXXXXXX` |
| `DEMO_MODE` | Set to `true` to skip real API calls | `true` |
| `MOCK_AUDIO_URLS` | Comma-separated list of audio file URLs | 5 SoundHelix sample MP3s |

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
MOCK_AUDIO_URLS = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3,https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3,https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3,https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3,https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3"
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

This starts the edge runtime locally. The HTTP entry point handles:

- `POST /jobs` — start a new orchestration job
- `GET /api/jobs/:jobId` — read job state

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

When the HTTP handler calls `startJob()`, the orchestrator:

1. Validates the job hasn't already started
2. Reads `MOCK_AUDIO_URLS` from env (comma-separated)
3. Transitions to `SPAWNING` status
4. **Spawns one child actor per audio file**:

```typescript
const child = await this.spawn(this.env.TRANSCRIBER, childName);
await child.assign({ audioUrl: urls[i], fileId, parentName: this.name });
```

5. Tracks each child in state with `RUNNING` status
6. Transitions to `RUNNING`
7. Schedules a stuck-child check: `await this.schedule(300, "checkChildren")`

### 4. Child Actor — `TranscriberAgent`

Each child is itself a persistent actor with its own state (`TranscriberState`). When the parent calls `assign()`, the child:

1. Stores the payload (audio URL, file ID, parent name)
2. Transitions to `RUNNING`
3. Calls `transcribeWithLLM()` — either mock (demo mode) or real LLM call
4. On success: stores the transcript, calls `reportComplete()` on the parent
5. On failure: stores the error, calls `reportFailure()` on the parent

**Key pattern — child→parent communication:**

There is no built-in parent handle on the child. The child reaches the parent via its own env binding:

```typescript
interface TranscriberEnv {
  SECRETS: Secrets;
  PARENT: ActorNamespace;  // binding to OrchestratorAgent
  TELNYX: TelnyxApi;
}
```

The parent's routing name is passed in the `assign()` payload:

```typescript
const parent = this.env.PARENT.idFromName(payload.parentName);
await parent.reportComplete(payload.fileId, transcript);
```

### 5. Parent Tracks Children — `children()` and State

The parent tracks children via its state (the `children` array). Each `ChildState` records:

- `name` — the child actor's name
- `type` — "Transcriber"
- `fileId` — which file this child handles
- `status` — PENDING → RUNNING → COMPLETED/FAILED
- `startedAt` / `completedAt` — timestamps
- `error` — error message if failed

The parent persists results to KV as they arrive:

```typescript
await this.env.JOB_KV.put(
  `job:${state.jobId}:file:${fileId}`,
  JSON.stringify({ status: "COMPLETED", transcript, childName })
);
```

### 6. Stuck-Child Detection — `schedule()`

When the job starts, the parent schedules a check 5 minutes out:

```typescript
await this.schedule(STUCK_TIMEOUT_SECONDS, "checkChildren");
```

The `checkChildren()` method runs at that time and marks any child still `RUNNING` as `FAILED`:

```typescript
async checkChildren(): Promise<void> {
  const state = await this.getState();
  if (state.status !== "RUNNING") return;

  const now = Date.now();
  const updatedChildren = state.children.map((c) => {
    if (c.status === "RUNNING" && now - Date.parse(c.startedAt) > STUCK_TIMEOUT_MS) {
      return { ...c, status: "FAILED", completedAt: nowIso(), error: "Timed out after 5 minutes" };
    }
    return c;
  });
  // ... update state, possibly finalize
}
```

### 7. Finalizing — `finalize()`

When all children have reported (or failed), the parent:

1. Transitions to `COMPLETING`
2. Queues `finalize()` with zero delay:

```typescript
await this.queue(0, "finalize");
```

3. In `finalize()`:
   - Determines final status (`COMPLETED` or `PARTIAL_FAILURE`)
   - Persists full job state to KV
   - Sends SMS notification (demo mode logs instead)
   - **Self-destructs**:

```typescript
await this.setState({ status: "CLEANING_UP" });
await this.destroy();
```

### 8. `destroy()` — Lifecycle Exit

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
- `SPAWNING` → `RUNNING`: all children spawned
- `RUNNING` → `COMPLETING`: all children reported (success or failure)
- `COMPLETING` → `COMPLETED`: zero failures
- `COMPLETING` → `PARTIAL_FAILURE`: some children failed
- `COMPLETED` / `PARTIAL_FAILURE` → `CLEANING_UP`: `finalize()` calls `destroy()`

---

## Demo Mode vs Live Mode

### Demo Mode (default)

Set `DEMO_MODE=true` in your environment. In demo mode:

- **Transcription**: Returns a mock transcript: `[demo] Mock transcript for {fileId} from {audioUrl}`
- **SMS**: Logs to console instead of sending: `[demo] SMS to operator: {message}`

This is safe — no real API calls, no charges.

### Live Mode

Set `DEMO_MODE=false` and configure:

- `TELNYX_API_KEY` — for the LLM transcription call
- `OPERATOR_NUMBER` — where SMS notifications go
- `TELNYX_SENDER` — the Telnyx number that sends SMS

In live mode:

- **Transcription**: Makes a real HTTP call to `https://api.telnyx.com/v2/ai/openai/chat/completions` with your API key
- **SMS**: Sends real SMS via `this.env.TELNYX.messages.send()`

---

## Telnyx Primitives Used

| Primitive | Usage |
|-----------|-------|
| `Agent` | Base class for both `OrchestratorAgent` and `TranscriberAgent` |
| `spawn()` | Parent creates child actors: `this.spawn(this.env.TRANSCRIBER, name)` |
| `children()` | List children with status (via state tracking) |
| `destroy()` | Clean up all children + self in one call |
| `schedule()` | Self-waking for timeout checks (5-minute stuck-child detection) |
| `queue()` | Start job immediately, queue `finalize()` |
| KV | Per-child results: `ctx.kv.put('job:${jobId}:file:${fileId}', ...)` |
| SMS | Operator notification via `this.env.TELNYX.messages.send()` |
| Inference | LLM transcription summary via raw REST call |

---

## API Reference

### `POST /jobs`

Start a new orchestration job.

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

### `GET /api/jobs/:jobId`

Read the full job state.

**Response:**
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
      "transcript": "[demo] Mock transcript for file-1 from https://...",
      "childName": "batch-transcription-job-42-file-1",
      "completedAt": "2026-07-28T12:00:05.000Z"
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

### Job stuck in `SPAWNING`

Check that the `TRANSCRIBER` actor binding is correctly configured in `telnyx.toml`. The child actor class must be exported from `src/index.ts`.

### Children not reporting back

Verify the `PARENT` binding on the `TranscriberAgent` is correctly typed. The parent's routing name must match the actor name used in `idFromName()`.

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
