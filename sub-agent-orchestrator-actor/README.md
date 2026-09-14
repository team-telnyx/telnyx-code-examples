---
name: sub-agent-orchestrator-actor
title: "Sub-Agent Orchestrator Actor — Durable Multi-Agent Workflows on Telnyx Edge"
description: "A persistent parent actor that spawns child actors for parallel transcription jobs, tracks their lifecycle, persists results, and self-cleans on completion — built on @telnyx/edge-runtime 0.15.2."
language: typescript
framework: edge
telnyx_products: [Edge Runtime, Agent SDK, SMS, AI, Inference]
---

# Sub-Agent Orchestrator Actor

A durable parent actor that spawns child actors for parallel transcription jobs, tracks each child's lifecycle (PENDING → RUNNING → COMPLETED → FAILED), persists results to KV, and self-cleans on completion. Built on the `spawn()`, `children()`, and `destroy()` primitives introduced in `@telnyx/edge-runtime` 0.15.2.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that makes this sample possible — a single platform where durable edge actors, AI inference, and SMS notifications work together. The Telnyx Edge Runtime gives you persistent, stateful actors that can spawn and manage child actors, while the Telnyx API handles operator notifications and AI-powered transcription summaries. No external orchestration services, no glue code — just one platform for the entire workflow.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/openai/chat/completions` | `POST` | LLM transcription summary (live mode, via raw REST) |
| `messages.send()` | — | SMS notification to operator on job completion (via `TELNYX` binding) |

## Architecture

The parent actor (`OrchestratorAgent`) IS the workflow. It owns the job state, spawns one child actor (`TranscriberAgent`) per audio file, tracks each child's lifecycle, accumulates results, and self-cleans when the job completes. Each child is a persistent actor with its own state — not a transient task.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HTTP Entry (src/index.ts)                    │
│                                                                     │
│  POST /jobs { jobId }          GET /api/jobs/:jobId                 │
│        │                              ▲                             │
│        ▼                              │                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              OrchestratorAgent (persistent parent)           │   │
│  │                                                              │   │
│  │  State: jobId, totalFiles, completed, failed, children[],    │   │
│  │         status, results[], createdAt, completedAt            │   │
│  │                                                              │   │
│  │  CREATED → SPAWNING → RUNNING → COMPLETING → COMPLETED       │   │
│  │                              ↘ PARTIAL_FAILURE               │   │
│  │                                                              │   │
│  │  spawn(TRANSCRIBER, name) ──┐                                │   │
│  │  children()                 │  track lifecycle               │   │
│  │  schedule(300, check)       │  stuck-child timeout           │   │
│  │  destroy()                  │  self-clean                    │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │ spawn() per audio file                            │
│                 ▼                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  TranscriberAgent (child, one per file)                      │   │
│  │                                                              │   │
│  │  State: fileId, audioUrl, parentName, status, transcript     │   │
│  │                                                              │   │
│  │  assign(payload) → transcribe → reportComplete(fileId,       │   │
│  │  transcript) → parent via PARENT binding                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  KV (JOB_KV)                                                │   │
│  │  job:{jobId} → full job state                               │   │
│  │  job:{jobId}:file:{fileId} → per-child result               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SMS (TELNYX binding)                                        │   │
│  │  Operator notified on completion / partial failure           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `OPERATOR_NUMBER` | `string` | `your_operator_number_here` | **yes** | OPERATOR_NUMBER | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_SENDER` | `string` | `your_telnyx_sender_here` | **yes** | TELNYX_SENDER | — |

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

4. **Run the smoke test:**

   ```bash
   npx tsx smoke_test.ts
   ```

5. **Deploy to Telnyx Edge:**

   ```bash
   npm run deploy
   ```

## API Reference

### `POST /jobs`

Starts a new orchestration job. The actor reads the audio file list from the `MOCK_AUDIO_URLS` env var.

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

Retrieves the full job state, including per-child status and compiled results.

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
      "transcript": "[demo] Mock transcript for file-1 from https://example.com/audio1.mp3",
      "childName": "batch-transcription-job-42-file-1",
      "completedAt": "2026-07-28T12:00:05.000Z"
    }
  ],
  "createdAt": "2026-07-28T12:00:00.000Z",
  "completedAt": "2026-07-28T12:00:10.000Z"
}
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `TELNYX_API_KEY secret not configured` | Missing API key in secrets | Run `telnyx-edge secrets add TELNYX_API_KEY "your-key"` |
| `MOCK_AUDIO_URLS env var is empty` | Env var not set in `telnyx.toml` | Add `[env_vars] MOCK_AUDIO_URLS = "https://..."` to `telnyx.toml` |
| `Job already started` | Calling `POST /jobs` with the same `jobId` twice | Use a unique `jobId` per job |
| Children stuck in `RUNNING` | Child actor crashed or timed out | Parent's `checkChildren()` marks stuck children as `FAILED` after 5 minutes |
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
