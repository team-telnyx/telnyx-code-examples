---
name: show-wrap-desk
title: "Show Wrap Desk — AI Podcast Production Studio"
description: "A durable AI agent that transcribes, chapterizes, writes show notes, and cuts a trailer for podcast episodes — surviving crashes between every stage."
language: typescript
framework: telnyx-edge (Stateful Actors)
telnyx_products: [Speech-to-Text, Text-to-Speech, AI Inference, Edge Compute Stateful Actors]
---

# Show Wrap Desk — AI Podcast Production Studio

One POST drops a raw episode recording; the desk cuts the tape (speaker-labeled transcription via Deepgram Nova-3), marks the chapters from word timestamps, writes the liner notes, and cuts a 30-second trailer in the host's own voice over the TTS WebSocket.

## The Story

A podcast production company runs a network of 40 shows, each with a weekly release cadence. The producer's team of editors spends 6–8 hours per episode on transcription cleanup, chapter marking, show notes, and trailer assembly — work that must be delivered before the scheduled release or the network loses ad revenue and listener trust. A missed deadline means a dead feed, angry sponsors, and a damaged reputation.

The actor IS the show wrap desk. It is born the moment a producer drops the first episode into the system, and it lives as a single durable entity per show — owning the episode ledger, the wrap task, and the resume point between every stage. When the platform reboots mid-wrap, the desk wakes up and continues exactly where it left off: the transcript is already cut, the chapters are already marked, the trailer is already voiced. It never redoes finished work, and it never loses an episode.

## Why Telnyx

Telnyx provides the complete **AI Communications Infrastructure** for this workflow — diarized Speech-to-Text (Deepgram Nova-3 with word-level speaker labels), the Text-to-Speech WebSocket for the trailer voice, zero-credential AI Inference through the `[telnyx]` binding, and Edge Compute Stateful Actors that keep the pipeline alive across crashes. No other platform gives you the speech primitives, the model runtime, and the durable identity model in one place.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/audio/transcriptions` | POST | Batch speech-to-text with Deepgram Nova-3, diarization, and word timestamps |
| `wss://api.telnyx.com/v2/text-to-speech/speech` | WebSocket | Stream the trailer in the host's voice until `isFinal: true` |
| TELNYX binding `ai.openai.chat.createCompletion` | — | Chapter titles, show notes, and the trailer script (zero-credential) |
| Agent SDK `schedule()` with stable id | — | `wrap:<epId>` task, upserted so a resume never duplicates work |
| Agent SDK `@rpc()` | — | Expose `wrapstatus(epId)` for the episode ledger |
| Agent SQL (`ctx.storage.sql`) | — | Episodes, chapters, and assets ledgers — zero external state |

## Architecture

The system is built around a single durable actor per show. The `WrapDesk` agent owns the episode ledger, the wrap task, and the resume points. The pipeline walks through four stages — transcribe → chapterize → notes+trailer → wrapped — and each stage is idempotent, so a crash between any two stages resumes cleanly on the next wake.

```
  POST /wrap {"show": "tok-podcast", "audioUrl": "..."}
        │
        ▼
  env.DESKS.idFromName("show:tok-podcast")        (one actor per show)
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ WrapDesk (Agent<Env, WrapState>)                          │
  │                                                           │
  │  onWrap(show, audioUrl)                                   │
  │    ├─ resume: unfinished episode w/ same audioUrl?        │
  │    │    └─ re-arm wrap:<epId> task                        │
  │    └─ birth: new episode, status "transcribing"           │
  │         └─ schedule wrapTick @ stable id wrap:<epId>      │
  │                                                           │
  │  wrapTick(epId)  ← dispatched by status                   │
  │    transcribing → STT (nova-3, diarize) → assets['transcript'] │
  │    chapterizing → speaker turns → gaps > 60s → LLM titles      │
  │                   → chapters table                        │
  │    notes        → LLM show notes → assets['notes']        │
  │                   → LLM picks boldest hook → 2-3 sentences │
  │                   → TTS WebSocket → isFinal → assets['trailer'] │
  │    wrapped      → done                                    │
  │                                                           │
  │  Agent SQL: episodes(ep_id, status, wrapped_at)           │
  │             chapters(ep_id, idx, title, start, end)       │
  │             assets(ep_id, kind, content)                  │
  │  Durable state: { episodes: { [epId]: {audioUrl, status} } } │
  └──────────────────────────────────────────────────────────┘
        │                        │
        ▼                        ▼
  POST /v2/ai/audio/       wss://api.telnyx.com/v2/
  transcriptions           text-to-speech/speech?voice=HOST_VOICE
  (multipart file,         (handshake → script → "" → collect base64
  deepgram/nova-3,          chunks until isFinal: true)
  diarize: true)
```

**Resume points.** The wrap task is scheduled once per episode under the stable id `wrap:<epId>`; the Agent SDK upserts it, so re-arming after a crash replaces rather than duplicates. A kill between stages leaves the episode's status pointing at the unfinished stage; the next wake — a re-armed task, or the same `POST /wrap` again — runs that stage, and the stage's asset/chapter check makes it a no-op if its output was already persisted.

## Environment Variables

> **Agent / CLI access** — the same provisioning from a terminal:
>
> ```bash
> # Authenticate the Telnyx CLI
> go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
> export TELNYX_API_KEY="your_telnyx_api_key_here"
>
> # The demo episode is public-domain audio; bring your own with:
> #   telnyx storage upload episode.mp3 (then pass its URL as audioUrl)
> #
> # AI Inference + STT + TTS need no extra provisioning — one API key covers all.
> ```

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API v2 key (secret, used by the STT upload and the TTS WebSocket) | [Portal](https://portal.telnyx.com/api-keys) |
| `EPISODE_URL` | `string` | `https://archive.org/download/sonnet_116_librivox/sonnet_116_shakespeare_add_64kb.mp3` | no | Default episode audio URL (public-domain LibriVox recording) | Any public mp3/wav |
| `AI_MODEL` | `string` | `zai-org/GLM-5.2` | no | Inference model for chapter titles, show notes, trailer script (in `telnyx.toml`) | [Models](https://developers.telnyx.com/docs/inference/models) |
| `HOST_VOICE` | `string` | `azure.en-US-AvaMultilingualNeural` | no | TTS voice for the trailer (in `telnyx.toml`) | `GET /text-to-speech/voices` |

Demo constants compiled into the code: `STT_MODEL` = `deepgram/nova-3`, `CHAPTER_GAP_S` = 60, trailer cap 400 characters.

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/show-wrap-desk
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "KEY0123..."
npm install
npm run types
npm run deploy
```

`deploy` runs `telnyx-edge ship`, which provisions the Edge Compute function,
registers the `WrapDesk` actor binding and the `[telnyx]` binding from
`telnyx.toml`, and prints the deployed URL.

</details>

2. **Install dependencies**

```bash
npm install
```

3. **Configure environment**

```bash
cp .env.example .env
```

Edit `.env` and set `TELNYX_API_KEY`. After you deploy, set `DEPLOY_URL` to the
URL `npm run deploy` prints.

4. **Generate types and deploy**

```bash
npm run types
npm run deploy
```

5. **Bootstrap the demo and watch it wrap**

```bash
npm run bootstrap
```

The bootstrap script POSTs the demo episode to `/wrap`, then polls
`/wrapstatus` until the episode lands `wrapped`, printing the chapter list,
the notes preview, and the trailer byte count. First run births the
`show:tok-podcast` desk; later runs reuse the same desk with new episode rows.

6. **Run the smoke test**

```bash
npm test
```

## API Reference

### `POST /wrap`

Register a new episode for wrapping — or resume one that is mid-wrap. The first call for a show births the desk; later calls for new episodes reuse the same desk instance.

```bash
curl -X POST https://show-wrap-desk-<id>.telnyxcompute.com/wrap \
  -H "Content-Type: application/json" \
  -d '{"show": "tok-podcast", "audioUrl": "https://archive.org/download/sonnet_116_librivox/sonnet_116_shakespeare_add_64kb.mp3"}'
```

**Response (202 Accepted):**

```json
{ "episodeId": "a1b2c3d4-...", "status": "transcribing", "resumed": false }
```

### `GET /wrapstatus/{episodeId}?show={show}`

Returns the episode ledger row plus the desk's full episode list.

```bash
curl "https://show-wrap-desk-<id>.telnyxcompute.com/wrapstatus/<episodeId>?show=tok-podcast"
```

**Response:**

```json
{
  "status": "wrapped",
  "chapters": [
    { "title": "A Sonnet About Constant Love", "start": 5.68, "end": 21.04 },
    { "title": "Love Is Not Love", "start": 22.1, "end": 45.8 }
  ],
  "notesPreview": "# Show Notes\n\nIn this episode...",
  "trailerBytes": 156960,
  "episodes": [
    {
      "ep_id": "a1b2c3d4-...",
      "audio_url": "https://archive.org/download/...",
      "status": "wrapped",
      "created_at": "2026-10-14T13:00:00.000Z",
      "wrapped_at": "2026-10-14T13:02:11.000Z"
    }
  ]
}
```

### `GET /health/{liveness,readiness}`

Health checks.

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `TELNYX_API_KEY is not configured` | Secret missing | `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `could not download the episode audio` | URL unreachable from the edge function | Use any publicly fetchable mp3/wav URL |
| `the transcription returned no word-level data` | Audio format unsupported by Deepgram | Nova-3 accepts mp3 and wav only |
| `the TTS WebSocket closed before the trailer finished` | Voice refused or network hiccup | Verify `HOST_VOICE` against `GET /text-to-speech/voices`; the wrap tick retries with backoff |
| `the model returned no content` | Inference hiccup or long transcript | Retry; the task scheduler retries automatically |
| Episode stuck in one status | Stage error recorded in the ledger | Check `error` in `GET /wrapstatus`; fix the cause and `POST /wrap` again — the stage resumes, nothing is re-cut |
| `bootstrap` can't reach the function | `DEPLOY_URL` not set in `.env` | Set it to the URL `npm run deploy` printed |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [AI Audiobook Narrator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-audiobook-narrator-python/README.md) — TTS narration, no ASR, no chapters
- [Edge Call Transcription Agent (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-call-transcription-agent/README.md) — live-call STT with the same agent SQL pattern
- [Edge URL Summarizer (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-url-summarizer/README.md) — caching stateful actor on Telnyx Edge Compute

## Resources

- [Transcribe Speech to Text](https://developers.telnyx.com/api-reference/audio/transcribe-speech-to-text) — the STT endpoint
- [Text-to-Speech Overview](https://developers.telnyx.com/docs/voice/tts/overview)
- [Stream Text-to-Speech over WebSocket](https://developers.telnyx.com/api-reference/websockets/stream-text-to-speech-over-websocket) — the trailer voice
- [TTS WebSocket lifecycle](https://developers.telnyx.com/docs/voice/tts/websocket-streaming) — handshake, frames, teardown
- [List Available Voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- [Agent SDK](https://developers.telnyx.com/docs/agent-sdk) — `Agent`, `schedule`, `@rpc`, agent SQL
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Product Page](https://telnyx.com/products/voice-ai-agents)
- [Pricing](https://telnyx.com/pricing)
