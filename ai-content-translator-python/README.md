---
name: ai-content-translator
title: "AI Content Translator"
description: "Upload any audio (podcast, meeting, lecture), STT transcribes in source language, AI Inference translates, TTS generates audio in target language. Returns translated transcript and a downloadable dubbed audio file."
language: python
framework: flask
telnyx_products: [AI Inference]
integrations: []
channel: [api]
---

# AI Content Translator

A Flask app that takes an audio file upload and runs the full STT → translate
→ TTS pipeline on Telnyx infrastructure. Useful for podcast localization,
meeting translation, lecture dubbing, and any other audio-to-audio
translation workflow.

## What It Does

- Accepts an audio file upload (mp3, wav, m4a, ogg, flac, webm) plus source and target language codes
- Calls Telnyx STT (`/v2/ai/transcribe`) to transcribe the audio in the source language (or auto-detect)
- Calls Telnyx AI Inference (`/v2/ai/chat/completions`) to translate the transcript with a TTS-friendly system prompt
- Calls Telnyx TTS (`/v2/ai/generate`) to render the translated text into the target language
- Concatenates the per-chunk TTS audio into one file and exposes a download URL
- Returns a JSON response with the job id, both transcripts, the audio URL, and a preview of each transcript

## Telnyx API Endpoints Used

- **STT Transcribe** — `POST /v2/ai/transcribe` — [reference](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference: Chat Completions** — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate** — `POST /v2/ai/generate` — [reference](https://developers.telnyx.com/api/inference/generate)

## Architecture

```
   multipart/form-data upload (audio file + source + target)
                    │
                    ▼
         ┌─────────────────────┐
         │ POST /translate     │
         └──────────┬──────────┘
                    │
        ┌───────────┴────────────┐
        │ Stage 1: STT           │  Telnyx /v2/ai/transcribe
        │  audio → transcript    │
        └───────────┬────────────┘
                    │
        ┌───────────┴────────────┐
        │ Stage 2: Translate     │  Telnyx /v2/ai/chat/completions
        │  transcript (src) →    │
        │  transcript (target)   │
        └───────────┬────────────┘
                    │
        ┌───────────┴────────────┐
        │ Stage 3: TTS           │  Telnyx /v2/ai/generate
        │  transcript (target) → │  (chunked if long)
        │  audio (target)        │
        └───────────┬────────────┘
                    │
                    ▼
       Job stored in memory with audio blob.
       GET /translate/<job_id>/audio → mp3 stream.
       GET /translate/<job_id>      → JSON with full transcript.
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | string | `KEY0123456789ABCDEF` | yes | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | string | `moonshotai/Kimi-K2.6` | no | AI Inference model used for translation | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | string | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `STT_MODEL` | string | `telnyx/asr` | no | STT model | [Docs](https://developers.telnyx.com/docs/inference) |
| `TTS_VOICE` | string | `AWS.Polly.Joanna-Neural` | no | Default TTS voice (overridden per language) | [Docs](https://developers.telnyx.com/docs/voice/call-control/commands/speak) |
| `TTS_FORMAT` | string | `mp3` | no | Output audio format (mp3, wav, etc) | — |
| `TTS_CHUNK_CHARS` | int | `1000` | no | Translate + TTS in chunks of N characters for long transcripts | — |
| `HOST` | string | `127.0.0.1` | no | Bind host | — |
| `PORT` | int | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-content-translator-python
cp .env.example .env
# Edit .env with your Telnyx API key
pip install -r requirements.txt
python app.py
```

Server starts on `http://localhost:5000`. No webhooks, no ngrok — this example is an HTTP upload API.

## Demo Flow

1. Start the app:

   ```bash
   python app.py
   ```

2. Translate a Spanish audio clip into English:

   ```bash
   curl -X POST http://localhost:5000/translate \
     -F audio=@spanish-sample.mp3 \
     -F source=es \
     -F target=en
   ```

3. Inspect the result:

   ```json
   {
     "job_id": "tr-a1b2c3d4",
     "status": "complete",
     "source": "es",
     "source_name": "Spanish",
     "target": "en",
     "target_name": "English",
     "original_length": 1847,
     "translated_length": 1923,
     "audio_segments": 2,
     "audio_bytes": 245760,
     "audio_url": "/translate/tr-a1b2c3d4/audio",
     "transcript_url": "/translate/tr-a1b2c3d4",
     "original_transcript_preview": "...",
     "translated_transcript_preview": "..."
   }
   ```

4. Download the translated audio:

   ```bash
   curl -OJ http://localhost:5000/translate/tr-a1b2c3d4/audio
   ```

5. Read the full transcripts:

   ```bash
   curl http://localhost:5000/translate/tr-a1b2c3d4 | python3 -m json.tool
   ```

To auto-detect the source language, omit the `source` field (or pass `source=auto`).

## Supported Languages

The `/languages` endpoint returns the supported set:

```bash
curl http://localhost:5000/languages
```

```json
{
  "languages": {
    "en": {"name": "English", "voice": "AWS.Polly.Joanna-Neural"},
    "es": {"name": "Spanish", "voice": "AWS.Polly.Lupe-Neural"},
    "fr": {"name": "French", "voice": "AWS.Polly.Lea-Neural"},
    "de": {"name": "German", "voice": "AWS.Polly.Vicki-Neural"},
    "pt": {"name": "Portuguese", "voice": "AWS.Polly.Ines-Neural"},
    "it": {"name": "Italian", "voice": "AWS.Polly.Bianca-Neural"},
    "ja": {"name": "Japanese", "voice": "AWS.Polly.Kazuha-Neural"},
    "ko": {"name": "Korean", "voice": "AWS.Polly.Seoyeon-Neural"},
    "zh": {"name": "Chinese", "voice": "AWS.Polly.Zhiyu-Neural"},
    "ar": {"name": "Arabic", "voice": "AWS.Polly.Zayd-Neural"},
    "hi": {"name": "Hindi", "voice": "AWS.Polly.Aditi-Neural"}
  },
  "supports_auto_detect": true
}
```

## API Reference

### `POST /translate`

Upload an audio file and translate it. Multipart form fields:

- `audio` — the audio file (required)
- `source` — source language code, or `auto` (default `auto`)
- `target` — target language code (default `en`)

```bash
curl -X POST http://localhost:5000/translate \
  -F audio=@spanish-sample.mp3 \
  -F source=es \
  -F target=en
```

### `GET /translate/<job_id>`

Get a translation job with full transcripts and segment list (no audio blob).

```bash
curl http://localhost:5000/translate/tr-a1b2c3d4
```

### `GET /translate/<job_id>/audio`

Stream the dubbed audio file. Returns `audio/mpeg` (or whatever `TTS_FORMAT` is set to).

```bash
curl -OJ http://localhost:5000/translate/tr-a1b2c3d4/audio
```

### `GET /languages`

List supported languages and their default voices.

```bash
curl http://localhost:5000/languages
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "ok",
  "jobs": 0,
  "supported_languages": 11,
  "ai_model": "moonshotai/Kimi-K2.6",
  "tts_model": "telnyx/tts",
  "stt_model": "telnyx/asr"
}
```

## Edge Cases Handled

- Missing audio file — 400 with explicit error message
- Empty audio file — 400 with explicit error message
- Unsupported source or target language — 400 with the supported list
- No speech detected in audio — 400 with `error: "No speech detected in audio"`
- STT failure — 502 with the upstream status code
- Translation failure — 500 with the exception name
- TTS failure on a chunk — 200 with `status: "partial"` and `error` describing which chunk failed (transcripts still returned)
- Long transcript — chunked at `TTS_CHUNK_CHARS` (default 1000 chars) by sentence boundary, each chunk TTS'd separately and concatenated
- Temp file cleanup — the uploaded file is written to a tempfile during STT and unlinked after the pipeline completes

## Going to Production

This example keeps translation jobs in memory for one hour. For production:

- **Storage** — replace the in-memory `jobs` dict with object storage (S3, GCS) for the audio blobs and a database (Postgres) for the metadata
- **Async pipeline** — run STT / translate / TTS in a queue (Celery, RQ) and have `POST /translate` enqueue and return a job id immediately
- **Long jobs** — return `202 Accepted` and let the client poll `/translate/<job_id>` until status is `complete`
- **Auth** — add API key validation on the upload endpoint
- **Limits** — cap upload size and reject audio longer than your STT model's limit before doing any work
- **Language detection** — switch to `source=auto` only when you trust STT's detection; pin `source` when the audio is well-known

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` from Telnyx | Invalid API key | Verify `TELNYX_API_KEY` matches [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `error: "No speech detected in audio"` | Audio has no speech or wrong `source` language | Re-encode the audio and retry; for non-English audio pass the correct `source` code |
| TTS chunk fails on a long file | One chunk's TTS call errored | Status comes back as `partial` with the failed chunk index; transcripts are still usable, audio is incomplete |
| `Unsupported target language` | Code not in the supported set | Run `curl http://localhost:5000/languages` to see the supported list |
| Audio download returns 409 | Audio generation has not finished or failed | Poll `/translate/<job_id>` until `audio_ready: true` |

## Related Examples

- [Build RAG with Telnyx Inference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md) — RAG over your knowledge base
- [Run LLM Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) — standalone inference
- [Build a Voice AI Agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) — voice agent reference

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI inference, and IoT on one private, global network. STT, AI inference, and TTS all run on the same private backbone, so the audio round trip stays under a second per chunk even when translating across continents.
