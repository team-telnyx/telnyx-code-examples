---
name: sub-agent-orchestrator-actor
title: "Sub-Agent Orchestrator Actor — Durable Multi-Agent Workflows on Telnyx Edge"
description: "A persistent parent actor that spawns child actors for parallel transcription jobs, tracks their lifecycle, resumes interrupted runs without redoing finished work, persists a per-file scorecard to KV, and self-cleans on completion — built on @telnyx/edge-runtime 0.15.2."
language: typescript
framework: edge
telnyx_products: [Edge Runtime, Agent SDK, SMS, AI, Inference]
---

# Sub-Agent Orchestrator Actor

A durable parent actor that spawns child actors for parallel transcription jobs, tracks each child's lifecycle (PENDING → RUNNING → COMPLETED → FAILED), persists results to KV, **resumes interrupted runs without redoing finished work**, and self-cleans on completion. Built on the `spawn()`, `children()`, `despawn()`, and `destroy()` primitives introduced in `@telnyx/edge-runtime` 0.15.2.

The use case behind the sample: a clinic-network transcription service loses its 3am batch to a power event. Because every child persists its per-file outcome to KV **before** reporting to the parent, the parent can re-spawn only the workers that never reported — never redoing finished work — and finish with an honest per-file scorecard (status, error reason, attempt count).

**What you get when you open the URL:**
- `GET /` — the clinic-facing service: tonight's batch, a power-event simulation, live per-recording progress, automatic recovery, and the morning report (scorecard + the exact SMS the manager receives)
- `GET /console` — the engineering view: actor names, attempt counts, KV keys, `RESUMED`/`ALREADY_DONE` badges, and the KV-first write order

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that makes this sample possible — a single platform where durable edge actors, AI inference, and SMS notifications work together. The Telnyx Edge Runtime gives you persistent, stateful actors that can spawn and manage child actors, while the Telnyx API handles operator notifications and AI-powered transcription summaries. No external orchestration services, no glue code — just one platform for the entire workflow.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/audio/transcriptions` | `POST` | Real speech-to-text transcription (live mode, via raw REST; `file_url` + `model`) |
| `/v2/messages` | `POST` | SMS notification to operator on job completion (live mode, via raw REST) |

> Both calls go over raw REST with `TELNYX_API_KEY` from SECRETS — the TELNYX binding surface is unverified in 0.15.2, so the guaranteed REST path is used. The transcription endpoint is verified live: it returns `{ "text": ... }` for public audio URLs with `distil-whisper/distil-large-v2`.

## Architecture

The parent actor (`OrchestratorAgent`) IS the workflow. It owns the job state, spawns one child actor (`TranscriberAgent`) per audio file, tracks each child's lifecycle, accumulates results, and self-cleans when the job completes. Each child is a persistent actor with its own state — not a transient task.

**KV is the source of truth.** Every child persists its per-file outcome to KV *before* reporting to the parent. The parent derives progress from KV, so a crash anywhere — child or parent — is recoverable by re-posting the same `jobId`: finished files are adopted, unfinished ones re-spawned (bounded by `MAX_CHILD_ATTEMPTS`), and nothing is ever done twice.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HTTP Entry (src/index.ts)                    │
│                                                                     │
│  GET /            operator console (launch, watch, recover, score)  │
│  POST /jobs { jobId }   (idempotent: STARTED/RESUMED/ALREADY_DONE)  │
│        │                       GET /api/jobs/:jobId                  │
│        ▼                              ▲                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              OrchestratorAgent (persistent parent)           │   │
│  │                                                              │   │
│  │  CREATED → SPAWNING → RUNNING → COMPLETING → COMPLETED       │   │
│  │                              ↘ PARTIAL_FAILURE               │   │
│  │                                                              │   │
│  │  spawn(TRANSCRIBER, name)   one child per file, parallel     │   │
│  │  children()                 cross-check live workers         │   │
│  │  reconcile()                KV-driven resume; re-spawn only  │   │
│  │                             what never reported (≤ attempts) │   │
│  │  schedule(watchdog)         stuck-child detection, stable id │   │
│  │  destroy()                  self-clean                       │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │ spawn() per audio file                            │
│                 ▼                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  TranscriberAgent (child, one per file)                      │   │
│  │                                                              │   │
│  │  assign(payload) → transcribe → KV-FIRST write per-file      │   │
│  │  outcome → reportComplete/reportFailure via PARENT binding   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  KV (JOB_KV) — the authority                                 │   │
│  │  job:{jobId}              → full job record + scorecard      │   │
│  │  job:{jobId}:file:{id}    → per-file outcome (child-written) │   │
│  │  job:{jobId}:attempt:{id} → attempt ledger (parent-written)  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SMS (raw REST)                                              │   │
│  │  Operator notified with the scorecard on completion /        │   │
│  │  partial failure                                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `true` | **yes** | `true` (default) mocks transcription and logs SMS; `false` enables live calls | — |
| `OPERATOR_NUMBER` | `string` | `+1555XXXXXXXX` | live mode | Phone number that receives the completion SMS | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | live mode | Telnyx API key for the transcription + SMS REST calls | [Telnyx Console → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `TELNYX_SENDER` | `string` | `+1555XXXXXXXX` | live mode | Telnyx number that sends the SMS | — |
| `MOCK_AUDIO_URLS` | `string` | 5 public-domain speech clips | **yes** | Comma-separated audio file list (one child per entry) | — |
| `TRANSCRIPTION_MODEL` | `string` | `distil-whisper/distil-large-v2` | no | Speech-to-text model for live transcription | — |
| `STUCK_TIMEOUT_SECONDS` | `string` | `300` | no | Watchdog window before a running child is treated as never-reported | — |
| `MAX_CHILD_ATTEMPTS` | `string` | `3` | no | Max re-spawn attempts per file before it is left `FAILED` | — |
| `DEMO_HANG_FILES` | `string` | `file-2` | no | Demo fault injection: file ids whose workers crash mid-run | — |
| `DEMO_HANG_MS` | `string` | `8000` | no | How long a hung demo worker stays down before crashing | — |
| `DEMO_DELAY_MS` | `string` | `0` | no | Per-file pacing in demo mode (≈2500 makes live progress watchable) | — |

> **Agent / CLI access** — provision what this example needs with the Telnyx CLI:
>
> ```bash
> # Buy a phone number for the SMS sender (live mode)
> telnyx number-orders create --phone-number "+1555XXXXXXXX"
> # List numbers you already own
> telnyx phone-numbers list
> ```

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Telnyx account with an API key
- `@telnyx/edge-runtime` ^0.15.2

### Local Development

1. **Clone the repository:**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/sub-agent-orchestrator-actor
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your values:

   ```bash
   DEMO_MODE=true
   OPERATOR_NUMBER=+1555XXXXXXXX
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_SENDER=+1555XXXXXXXX
   ```

4. **Run the smoke test and the recovery test:**

   ```bash
   npx tsx smoke_test.ts
   npx tsx recovery_test.ts
   ```

   The recovery test runs the full DEV-1085 use case in-memory: fresh start,
   a simulated 3am power event (resume without redoing finished work), stuck-child
   watchdog with bounded re-spawn, request-level fault injection, and the
   ALREADY_DONE no-op after completion.

5. **Open the clinic service and watch the story run:**

   ```bash
   npm run dev
   ```

   Then open `http://localhost:8787/` (or your local edge port) — the clinic
   nightly-batch experience: start the batch with a consult marked as "on the
   fault circuit", watch it go down and recover automatically, then read the
   morning report. The engineering view is at `/console`.

6. **Deploy to Telnyx Edge:**

   ```bash
   npm run deploy
   ```

## API Reference

### `GET /`

The clinic-facing front door — the use case as a product:

1. **Tonight's batch** — the nightly queue of consult recordings; mark which are "on tonight's fault circuit" (the 3am power event), then start the batch
2. **Batch progress** — live per-recording cards (transcribing/done/failed), transcripts as they land, and the incident timeline ("worker went down during the batch — re-run automatically, never redone")
3. **Power returned** — re-post the same batch ID: finished recordings are adopted untouched, lost workers re-spawn; a finished batch answers `ALREADY_DONE`
4. **Morning report** — the honest scorecard (what succeeded, what failed, why) plus the exact operator SMS, stored on the record

### `GET /console`

The engineering console — actors, worker names (`-r1`/`-r2`), attempt counts, KV keys, and the idempotent re-post badges. This is the "look under the hood" layer.

### `GET /config`

Non-secret knobs for the console: `audioUrls`, `transcriptionModel`, `stuckTimeoutSeconds`, `maxAttempts`, `demoMode`.

### `POST /jobs`

Idempotent: starts, resumes, or no-ops depending on the job's state. The audio list and fault injection can come from env or from the request body.

**Request body:**

```json
{
  "jobId": "batch-transcription-job-42",
  "audioUrls": ["https://example.org/recording-1.wav"],
  "hangFiles": ["file-2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | yes | Unique identifier — also the actor routing name |
| `audioUrls` | string[] | no | Overrides `MOCK_AUDIO_URLS` (max 12, must be http/https) |
| `hangFiles` | string[] | no | Workers for these files crash on EVERY attempt (overrides `DEMO_HANG_FILES`) |
| `hangOnce` | string[] | no | One-shot power event: the first attempt crashes, the re-spawned worker succeeds |
| `stuckTimeoutSeconds` | number | no | Per-job watchdog window (UIs pass 6 for demo tempo) |
| `demoMode` | boolean | no | Job-level demo pin — mock transcripts + logged SMS when true |

**Response:**

```json
{
  "jobId": "batch-transcription-job-42",
  "status": "STARTED"
}
```

- `"STARTED"` — fresh job; children spawned.
- `"RESUMED"` — job was already active; finished files adopted from KV, only never-reported workers re-spawned.
- `"ALREADY_DONE"` — job already finished; the KV record is returned as-is and finished work is never redone.

### `GET /api/jobs/:jobId`

Retrieves the persisted job record, including per-file outcome (`outcomes`), per-child ledger (`children`), and compiled results.

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
      "error": null,
      "attempts": 1
    }
  ],
  "status": "COMPLETED",
  "results": [
    {
      "fileId": "file-1",
      "transcript": "[demo] Mock transcript for file-1 from https://example.com/audio1.mp3",
      "childName": "batch-transcription-job-42-file-1",
      "attempts": 1,
      "completedAt": "2026-07-28T12:00:05.000Z"
    }
  ],
  "outcomes": [
    {
      "fileId": "file-1",
      "status": "COMPLETED",
      "transcript": "[demo] Mock transcript for file-1 from https://example.com/audio1.mp3",
      "error": null,
      "attempts": 1,
      "childName": "batch-transcription-job-42-file-1"
    }
  ],
  "createdAt": "2026-07-28T12:00:00.000Z",
  "completedAt": "2026-07-28T12:00:10.000Z",
  "notification": "Job batch-transcription-job-42 complete: 5/5 transcripts compiled."
}
```

`notification` is the exact SMS text delivered to `OPERATOR_NUMBER` (the console displays it).

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `TELNYX_API_KEY secret not configured` | Missing API key in secrets | Run `telnyx-edge secrets add TELNYX_API_KEY "your-key"` |
| `MOCK_AUDIO_URLS env var is empty` | Env var not set in `telnyx.toml` | Add `[env_vars] MOCK_AUDIO_URLS = "https://..."` to `telnyx.toml` |
| Re-posting a job returns `ALREADY_DONE` but you expected a re-run | The job finished previously — KV is the authority | Use a new `jobId` for a fresh run |
| Children stuck in `RUNNING` | Child actor crashed or timed out | The watchdog (`STUCK_TIMEOUT_SECONDS`, default 300s) marks stuck children as never-reported and `reconcile()` re-spawns them, up to `MAX_CHILD_ATTEMPTS` |
| A file stays `FAILED` in the scorecard | Attempts exhausted | Check `outcomes[].error` for the reason; raise `MAX_CHILD_ATTEMPTS` or fix the failure cause |
| SMS not sent in demo mode | `DEMO_MODE=true` | SMS is logged to console instead of sent. Set `DEMO_MODE=false` for live mode |
| `OPERATOR_NUMBER/TELNYX_SENDER secrets required` | Missing secrets in live mode | Add both secrets via `telnyx-edge secrets add` |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Stateful Agent with KV Store](../stateful-agent-kv-store/)
- [Scheduled Agent Tasks](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge/scheduled-tasks)
- [Agent WebSocket Streaming](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge/websocket-streaming)

## Resources

- [Telnyx Edge Runtime Documentation](https://developers.telnyx.com/docs/edge)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx SDK on npm](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
