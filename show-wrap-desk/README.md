---
name: show-wrap-desk
title: "Show Wrap Desk — AI Podcast Production Studio"
description: "A durable AI agent that transcribes, chapterizes, writes show notes, and cuts a trailer for podcast episodes — surviving crashes between every stage."
language: typescript
framework: edge
telnyx_products: [Speech-to-Text, Text-to-Speech, Agent SDK, Stateful Actors]
---

# Show Wrap Desk — AI Podcast Production Studio

One POST drops a raw episode recording; the desk cuts the tape (speaker-labeled transcription), marks the chapters, writes the liner notes, and cuts a 30-second trailer in the host's own voice.

## The Story

A podcast production company runs a network of 40 shows, each with a weekly release cadence. The producer's team of editors spends 6–8 hours per episode on transcription cleanup, chapter marking, show notes, and trailer assembly — work that must be delivered before the scheduled release or the network loses ad revenue and listener trust. A missed deadline means a dead feed, angry sponsors, and a damaged reputation.

The actor IS the show wrap desk. It is born the moment a producer drops the first episode into the system, and it lives as a single durable entity per show — owning the episode ledger, the wrap task, and the resume point between every stage. When the platform reboots mid-wrap, the desk wakes up and continues exactly where it left off: the transcript is already cut, the chapters are already marked, and the trailer is already voiced. It never redoes finished work, and it never loses an episode. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the complete **AI Communications Infrastructure** for this workflow — the Speech-to-Text API for diarized transcription, the Text-to-Speech WebSocket for the trailer voice, and the Agent SDK's durable stateful actors that keep the pipeline alive across crashes. No other platform gives you the speech primitives, the agent runtime, and the identity model in one place.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/audio/transcriptions` | POST | Batch speech-to-text with Deepgram Nova-3, diarization, and word timestamps |
| `wss://api.telnyx.com/v2/text-to-speech/speech` | WebSocket | Stream the trailer voice in the host's voice |
| `GET /text-to-speech/voices` | GET | List available TTS voices |
| Agent SDK `@rpc()` | — | Expose `wrapstatus(epId)` for episode ledger queries |
| Agent SDK `schedule()` | — | Stable-id task scheduling for the wrap pipeline |

## Architecture

The system is built around a single durable actor per show. The `WrapDesk` agent owns the episode ledger, the wrap task, and the resume points. The pipeline walks through four stages — transcribe → chapterize → notes → trailer — and each stage is idempotent, so a crash between any two stages resumes cleanly on the next wake.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Producer (POST /wrap)                      │
│                        { show, audioUrl }                           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      env.DESKS.idFromName("show:...")               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    WrapDesk (Agent)                           │  │
│  │                                                               │  │
│  │  State: { episodes: { epId: { audioUrl, status } } }          │  │
│  │                                                               │  │
│  │  onWrap(ep) ──► store episode ──► schedule("wrapTick")        │  │
│  │                                                               │  │
│  │  wrapTick(epId) ──► status machine:                          │  │
│  │     transcribing ──► chapterizing ──► notes ──► wrapped       │  │
│  │                                                               │  │
│  │  Each step idempotent — checks SQL before re-running          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  SQL Ledger (episodes, chapters, assets, transcripts, notes)│    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Telnyx APIs                                                        │
│  ┌────────────────────┐  ┌──────────────────────────────────────┐   │
│  │ STT (Deepgram)     │  │ TTS WebSocket (host voice)           │   │
│  │ POST /v2/ai/audio/ │  │ wss://api.telnyx.com/v2/text-to-     │   │
│  │ transcriptions     │  │ speech/speech?voice=HOST_VOICE       │   │
│  └────────────────────┘  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | Telnyx Portal → API Keys |
| `EPISODE_URL` | `string` | `https://example.com/episode.mp3` | no | Default demo episode audio URL | Your own hosted audio |
| `HOST_VOICE` | `string` | `azure.en-US-AvaMultilingualNeural` | no | TTS voice for the trailer | `GET /text-to-speech/voices` |
| `CHAPTER_GAP_S` | `string` | `60` | no | Gap in seconds that splits chapters | Hardcoded demo constant |
| `STT_MODEL` | `string` | `deepgram/nova-3` | no | Speech-to-text model | Hardcoded demo constant |
| `WRAP_POLL_S` | `string` | `60` | no | Poll interval for the wrap task | Hardcoded demo constant |
| `DEMO_MODE` | `string` | `true` | no | Set to `false` to use live Telnyx APIs | — |

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/show-wrap-desk
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure environment variables**

Copy the `.env.example` file to `.env` and fill in your Telnyx API key:

```bash
cp .env.example .env
```

Edit `.env` and set `TELNYX_API_KEY` to your actual key. The default `DEMO_MODE=true` runs the pipeline with simulated data — no real API calls, no charges.

4. **Generate types and deploy**

```bash
npm run types
npm run deploy
```

5. **Run the smoke test**

```bash
npx tsx smoke_test.ts
```

## API Reference

### `POST /api/wrap`

Accepts a JSON body with `show` and `audioUrl`. The first call for a show births the desk; subsequent calls for new episodes reuse the same desk instance.

**Request body:**

```json
{
  "show": "tok-podcast",
  "audioUrl": "https://example.com/episode-42.mp3"
}
```

**Response (202 Accepted):**

```json
{
  "episodeId": "a1b2c3d4-...",
  "status": "transcribing"
}
```

### `GET /api/wrapstatus/{episodeId}`

Returns the episode ledger row: current status, chapters, notes preview, and trailer byte count.

**Response:**

```json
{
  "status": "wrapped",
  "chapters": [
    { "title": "Chapter 1", "start": 0, "end": 120 },
    { "title": "Chapter 2", "start": 180, "end": 300 }
  ],
  "notesPreview": "In this episode, we explore...",
  "trailerBytes": 1024
}
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `TELNYX_API_KEY secret not configured` | Missing API key in `.env` or secrets | Set `TELNYX_API_KEY` in `.env` or via `telnyx-edge secrets add TELNYX_API_KEY "..."` |
| STT returns 401 | Invalid or expired API key | Verify the key in the Telnyx Portal |
| TTS WebSocket connection fails | Network egress blocked or voice not found | Check the voice name against `GET /text-to-speech/voices` |
| Episode stuck in `transcribing` | STT API call failed or timed out | Check the error field in the episode ledger via `wrapstatus` |
| Demo mode doesn't produce real audio | `DEMO_MODE=true` is set | Set `DEMO_MODE=false` in `.env` to use live APIs |
| Deploy fails with `telny-edge ship` | CLI not authenticated | Run `telny-edge auth api-key set <KEY>` first |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://developers.telnyx.com/llms.txt)

## Related Examples

- **AI Audiobook Narrator** — book narration with TTS, no ASR, no chapters, no notes
- **Voice Agent with Call Control** — real-time voice agent using Call Control
- **SMS Notification Agent** — outbound SMS via the Agent SDK

## Resources

- [Speech-to-Text API Reference](https://developers.telnyx.com/api-reference/audio/transcribe-speech-to-text)
- [Text-to-Speech Overview](https://developers.telnyx.com/docs/voice/tts/overview)
- [Text-to-Speech REST API](https://developers.telnyx.com/docs/voice/tts/rest-api)
- [List Available Voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- [Stream TTS over WebSocket](https://developers.telnyx.com/api-reference/websockets/stream-text-to-speech-over-websocket)
- [Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Product Page](https://telnyx.com)
- [Pricing](https://telnyx.com/pricing)
