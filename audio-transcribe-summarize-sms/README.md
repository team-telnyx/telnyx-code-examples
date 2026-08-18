---
name: audio-transcribe-summarize-sms
title: "Audio Transcribe → Summarize → SMS"
description: "Upload a voicemail audio file → transcribe via STT → summarize with LLM → text the summary via SMS. Agent SDK pipeline on Telnyx Edge Compute with zero-credential inference and messaging."
language: nodejs
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, AI Inference, Messaging, Cloud Storage]
channel: [sms]
---

# Audio Transcribe → Summarize → SMS

Upload a voicemail audio file → transcribe it → summarize with LLM → text the summary to the user. An end-to-end pipeline orchestrated by the Agent SDK on Telnyx Edge Compute, with zero-credential inference and messaging via the `[telnyx]` binding.

## Telnyx API Endpoints Used

- **AI Audio Transcriptions**: `POST /v2/ai/audio/transcriptions` — [API reference](https://developers.telnyx.com/api/inference/create-transcription) — speech-to-text
- **AI Inference**: `POST /v2/ai/openai/chat/completions` — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated binding)
- **Messaging**: `POST /v2/messages` — via `this.env.TELNYX.messages.send()` (pre-authenticated binding)
- **Cloud Storage**: S3-compatible API at `https://{region}.telnyxcloudstorage.com` — [docs](https://developers.telnyx.com/docs/cloud-storage)

## Architecture

```
  Upload audio file (POST /upload)
        │
        ▼
  ┌──────────────────────────────────────────┐
  │ Upload to Cloud Storage (S3 PUT, SigV4)    │
  └────────┬─────────────────────────────────┘
           │
           ▼
  ┌──────────────────────────────────────────┐
  │ VoicemailAgent.start()                     │
  │  → this.queue("transcribe")                │
  │  → this.queue("summarize")                 │
  │  → this.queue("notify")                    │
  └────────┬─────────────────────────────────┘
           │
           ▼
  Stage 1: transcribe()
    → Download audio from Cloud Storage (S3 GET)
    → POST /v2/ai/audio/transcriptions (STT)
    → Store transcript in agent state
           │
           ▼
  Stage 2: summarize()
    → this.env.TELNYX.ai.openai.chat.createCompletion()
    → Store summary in agent state
           │
           ▼
  Stage 3: notify()
    → this.env.TELNYX.messages.send()
    → SMS summary delivered to recipient
```

## Environment Variables / Secrets

No API key needed in code for inference or SMS — the `[telnyx]` binding in `telnyx.toml` carries auth. Cloud Storage and STT require `TELNYX_API_KEY` as a secret.

```toml
[telnyx]
binding = "TELNYX"
```

| Variable | Type | Required | Description | Where to get it |
|----------|------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | secret | **yes** | Telnyx API v2 key (for Cloud Storage + STT) | [Portal](https://portal.telnyx.com/api-keys) |
| `STORAGE_BUCKET` | config | **yes** | Cloud Storage bucket name | [Portal](https://portal.telnyx.com/storage) |
| `STORAGE_REGION` | config | no | Storage region (default `us-central-1`) | [Docs](https://developers.telnyx.com/docs/cloud-storage) |
| `AI_MODEL` | config | no | LLM model for summarization (default `zai-org/GLM-5.2`) | [Models](https://developers.telnyx.com/docs/inference/models) |
| `SENDER_PHONE` | config | **yes** | Telnyx number to send SMS from | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `[telnyx]` binding | toml | **yes** | Pre-authenticated Telnyx client (inference + messaging) | `telnyx.toml` |

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx Cloud Storage bucket (create in [Portal](https://portal.telnyx.com/storage))
- A Telnyx phone number with SMS capability

### 1. Install & configure

```bash
npm install
```

### 2. Set secrets

```bash
telnyx-edge secret set TELNYX_API_KEY KEY0123456789ABCDEF
telnyx-edge secret set STORAGE_BUCKET my-voicemail-bucket
telnyx-edge secret set SENDER_PHONE +18005551234
```

### 3. Deploy

```bash
telnyx-edge ship
```

`ship` prints a URL like `audio-transcribe-summarize-sms-<id>.telnyxcompute.com`.

### 4. Test

```bash
# Health check
curl https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/health/liveness

# Upload a voicemail audio file → triggers the full pipeline
curl -X POST https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/upload \
  -F "file=@voicemail.wav" \
  -F "recipient_phone=+17177247292"

# Check pipeline status
curl https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/status/<agentId>
```

## API Reference

### `POST /upload`

Upload an audio file and trigger the transcribe → summarize → SMS pipeline.

```bash
curl -X POST https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/upload \
  -F "file=@voicemail.wav" \
  -F "recipient_phone=+17177247292"
```

**Response:**

```json
{
  "action": "queued",
  "audioKey": "voicemails/1724359200000-voicemail.wav",
  "agentId": "voicemails-1724359200000-voicemail.wav",
  "recipientPhone": "+17177247292",
  "statusUrl": "/status/voicemails-1724359200000-voicemail.wav"
}
```

### `GET /status/:agentId`

Check the pipeline status for a given upload.

```bash
curl https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/status/voicemails-1724359200000-voicemail.wav
```

**Response:**

```json
{
  "audioKey": "voicemails/1724359200000-voicemail.wav",
  "bucket": "my-voicemail-bucket",
  "recipientPhone": "+17177247292",
  "senderPhone": "+18005551234",
  "transcript": "Hi, this is John. I'm calling about the invoice from last week...",
  "summary": "John called about an invoice from last week. He wants a callback to discuss it.",
  "status": "done",
  "error": "",
  "createdAt": 1724359200000,
  "completedAt": 1724359210000
}
```

### `GET /health/{liveness,readiness}`

Health checks.

```bash
curl https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/health/liveness
```

## How It Works

1. **Upload** — `POST /upload` receives a multipart form with an audio file and recipient phone number. The file is uploaded to Telnyx Cloud Storage via S3 PUT (AWS SigV4 signing with Web Crypto API).
2. **VoicemailAgent.start()** — Creates a stateful actor instance, stores the audio key, bucket, and phone numbers, then queues the first pipeline stage.
3. **transcribe()** — Downloads the audio from Cloud Storage via S3 GET, sends it to `POST /v2/ai/audio/transcriptions` for speech-to-text, stores the transcript in agent state.
4. **summarize()** — Sends the transcript to `this.env.TELNYX.ai.openai.chat.createCompletion()` (zero-credential binding) with a system prompt that produces an SMS-friendly summary.
5. **notify()** — Sends the summary via `this.env.TELNYX.messages.send()` (zero-credential binding) to the recipient's phone.
6. **Persistence** — All state (transcript, summary, status) survives across pipeline stages in the actor's durable storage.

## Agent SDK Primitives Used

| Primitive | API | What it does |
|-----------|-----|--------------|
| Pipeline | `this.queue("transcribe")` / `this.queue("summarize")` / `this.queue("notify")` | Non-blocking pipeline stages |
| Durable State | `this.setState()` / `this.getState()` | Per-voicemail state (audioKey, transcript, summary, status) |
| Telnyx Binding | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential LLM inference |
| Telnyx Binding | `this.env.TELNYX.messages.send()` | Zero-credential SMS |
| Cloud Storage | S3 PUT/GET with SigV4 | Audio file upload/download |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `S3 PUT failed: 403` | Wrong API key or bucket | Verify `TELNYX_API_KEY` and `STORAGE_BUCKET` are set correctly |
| `STT failed: 401` | API key not set | Set `TELNYX_API_KEY` secret via `telnyx-edge secret set` |
| `LLM returned empty summary` | Model unavailable or reasoning model | Check `AI_MODEL` — use non-reasoning model like `zai-org/GLM-5.2` |
| No SMS received | `SENDER_PHONE` not set | Set a Telnyx number with SMS capability |
| Actor not processing | `[telnyx]` binding missing | Ensure `telnyx.toml` has `[telnyx] binding = "TELNYX"` |
| `404 page not found` | Function still deploying | Wait ~30s, then retry |

## Related Examples

- [SMS Support Agent with Follow-Up (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-support-agent-with-followup/README.md)
- [Agent with Tool Calling (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-with-tool-calling/README.md)
- [AI Voicemail Smart Router (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-smart-router-python/README.md)
- [Storage Voicemail Archive (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/storage-voicemail-archive-python/README.md)
- [Edge Voicemail to Action (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voicemail-to-action-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK Quickstart](https://developers.telnyx.com/docs/agent-sdk/quickstart)
- [Roll Your Own Agent](https://developers.telnyx.com/docs/agent-sdk/examples/roll-your-own)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Audio Transcriptions API](https://developers.telnyx.com/api/inference/create-transcription)
- [Cloud Storage Quick Start](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — voice, messaging, SIP, AI, IoT, and Cloud Storage on one private, global network. This sample uses four Telnyx products (Edge Compute, AI Inference, Messaging, Cloud Storage) through a single API key and one deploy command. The Agent SDK's `[telnyx]` binding means LLM inference and SMS delivery need zero credentials in code, while Cloud Storage and STT use the same key for S3-compatible uploads and audio transcription.
