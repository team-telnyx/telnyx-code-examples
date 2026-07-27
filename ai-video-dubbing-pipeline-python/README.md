---
name: ai-video-dubbing-pipeline
title: "AI Video Dubbing Pipeline"
description: "Upload audio, STT transcribes, AI Inference labels speakers + translates to target language, TTS generates a dubbed audio track with speaker-matched voices. Full STT-to-TTS pipeline."
language: python
framework: flask
telnyx_products: [AI Inference, Speech-to-Text, Text-to-Speech]
integrations: []
channel: [voice, api]
---

# AI Video Dubbing Pipeline

Upload audio, STT transcribes it, AI Inference labels speakers and translates the dialogue to a target language, and TTS renders a dubbed audio track with speaker-matched voices. Full STT-to-TTS pipeline on Telnyx.

## Telnyx API Endpoints Used

- **Speech-to-Text (STT)**: `POST /v2/ai/audio/transcriptions` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference (chat)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **Text-to-Speech (TTS)**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api/text-to-speech/generate-speech-from-text)
- **TTS Voices list**: `GET /v2/text-to-speech/voices` -- [ref](https://developers.telnyx.com/api/text-to-speech/list-voices)

## Architecture

```
  Upload audio (POST /dub)
        │
        ▼
  ┌──────────────────┐
  │ STT (Whisper)     │ ── transcribe audio → segments with start/end/text
  │ POST /v2/ai/audio/│
  │  transcriptions   │
  └────────┬──────────┘
           │ segments
           ▼
  ┌──────────────────┐
  │ AI Inference      │ ── label speakers + translate to target language
  │ POST /v2/ai/chat/ │    (LLM assigns SPEAKER_0, SPEAKER_1, ... and translates)
  │   completions     │
  └────────┬──────────┘
           │ translated segments with speaker labels
           ▼
  ┌──────────────────┐
  │ TTS (Kokoro)      │ ── render each segment with a speaker-matched voice
  │ POST /v2/text-to- │    (voices cycled from a pool per speaker)
  │  speech/speech    │
  └────────┬──────────┘
           │
           ├──► GET /dub/<job_id>      (status + transcript)
           ├──► GET /dub/<job_id>/audio (download mp3)
           └──► GET /dub/<job_id>/transcript (side-by-side text)
```

## How It Works

1. **STT** transcribes the uploaded audio into timestamped segments (Whisper-large-v3-turbo, multilingual).
2. **AI Inference** receives all segments in one call and returns a JSON array that assigns a speaker label (`SPEAKER_0`, `SPEAKER_1`, ...) to each segment AND translates the text to the target language. Telnyx STT does not diarize, so the LLM handles speaker labeling from conversational context.
3. **TTS** synthesizes each translated segment using a voice assigned per speaker from a KokoroTTS voice pool (`am_onyx`, `am_echo`, `af_nova`, `af_heart`, `af_alloy`). The per-job audio chunks are concatenated and downloadable as a single mp3.

The pipeline runs **asynchronously**: `POST /dub` returns `202` with a `job_id`, and the client polls `GET /dub/<job_id>` until `status == "complete"`.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Co-located inference** — LLM, STT, and TTS run on the same network as voice traffic. Sub-200ms round trips.
- **OpenAI-compatible APIs** — the STT and chat endpoints are drop-in for the OpenAI Python/JS SDK (set base URL to `https://api.telnyx.com/v2`).

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Chat-completions model id | [Models list](https://developers.telnyx.com/docs/inference/list-models) |
| `STT_MODEL` | `string` | `openai/whisper-large-v3-turbo` | no | STT model id (multilingual). Use `distil-whisper/distil-large-v2` for English-only. | [Models list](https://developers.telnyx.com/docs/inference/list-models) |
| `HOST` | `string` | `127.0.0.1` | no | Bind host | — |
| `PORT` | `int` | `5000` | no | Bind port | — |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


> TTS does not take a model id — it uses **voice ids** (e.g. `Telnyx.KokoroTTS.am_onyx`). List voices with `GET /v2/text-to-speech/voices`.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-video-dubbing-pipeline-python
cp .env.example .env
# edit .env and paste your Telnyx API key
pip install -r requirements.txt
python app.py
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


Server starts on `http://127.0.0.1:5000`. This is a pure HTTP API — no webhooks, no ngrok, no phone number required.

## API Reference

### `POST /dub` — start a dubbing job (async)

Upload as multipart form:

```bash
curl -X POST http://localhost:5000/dub \
  -F audio=@episode.mp3 \
  -F target_language=es \
  -F source_language=en
```

**Response `202`:**

```json
{
  "job_id": "dub-a1b2c3d4",
  "status": "queued",
  "source_language": "en",
  "target_language": "es (Spanish)",
  "message": "Pipeline started. Poll GET /dub/<job_id> for status."
}
```

### `GET /dub/<job_id>` — job status + transcript

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4 | python3 -m json.tool
```

Statuses: `queued`, `transcribing`, `translating`, `synthesizing`, `complete`, `failed`.

### `GET /dub/<job_id>/audio` — download the dubbed mp3

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/audio --output dubbed.mp3
```

### `GET /dub/<job_id>/transcript` — side-by-side text

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/transcript | python3 -m json.tool
```

### `GET /languages` — supported target languages

### `GET /jobs` — list all jobs (metadata)

### `GET /health` — health check

```bash
curl http://localhost:5000/health
```

```json
{"status": "ok", "total_jobs": 0, "active": 0, "supported_languages": 15, "version": "1.0.0"}
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Unauthorized**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **STT returns no segments**: Audio may be too short or silent. Try a clip with clear speech (≥ 1 second).
- **LLM JSON parse fallback**: If the chat model returns non-JSON, the pipeline falls back to translating each segment individually and labeling everything as `SPEAKER_0`. Check logs for the raw model output.
- **TTS voice mismatch**: Voices must be valid Telnyx voice ids (see `GET /v2/text-to-speech/voices`). The example uses KokoroTTS voices by default.

## Related Examples

- [run-llm-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) - Standalone inference
- [build-voice-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) - Voice AI agent

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Text-to-Speech Guide](https://developers.telnyx.com/docs/voice/text-to-speech)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
