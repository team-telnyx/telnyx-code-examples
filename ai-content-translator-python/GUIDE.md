# AI Content Translator — Build Guide

A Flask app that runs the full STT → translate → TTS pipeline on a single
audio upload. Built on Telnyx AI Inference.

## What It Does

You POST an audio file plus a target language. The app:

1. Calls Telnyx STT to transcribe the audio in the source language
2. Calls Telnyx AI Inference to translate the transcript into the target language, using a TTS-friendly system prompt that keeps the result natural when spoken
3. Calls Telnyx TTS to render the translated text into audio, chunked if the transcript is long
4. Stores the resulting audio in memory and returns a download URL plus both transcripts

## How It Works

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

## Telnyx Products Used

- **AI Inference** — STT, chat completions, and TTS all live on Telnyx infrastructure. STT runs on `/v2/ai/transcribe`, translation on `/v2/ai/chat/completions`, TTS on `/v2/ai/generate`.

## API Endpoints

- **STT Transcribe** — `POST /v2/ai/transcribe` — [reference](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference: Chat Completions** — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate** — `POST /v2/ai/generate` — [reference](https://developers.telnyx.com/api/inference/generate)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

This is a pure HTTP API — no phone number, no webhooks, no ngrok.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-content-translator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx API key.

## Step 2: Understand the Code

Everything lives in `app.py`. The interesting bits:

### `_stt(audio_bytes, language)`

POSTs the audio bytes to `/v2/ai/transcribe` with `timestamps: true`. Returns the raw STT response (text + segments).

### `_chat(messages, max_tokens)`

OpenAI-compatible chat completions wrapper. Used for translation with a TTS-friendly system prompt.

### `_tts(text, voice, language)`

POSTs to `/v2/ai/generate`. Handles the three common response shapes the Telnyx TTS endpoint can return:

1. Raw audio bytes (when `Content-Type` is `audio/...`)
2. JSON with `audio_base64`
3. JSON with `audio.url` (or `data[0].url` or `data[0].b64_json`) — fetched and returned as bytes

### `_chunk_text(text, max_chars)`

Splits a long transcript on sentence boundaries (`?`, `!`, `.`, `。`, `？`, `！`) into chunks of at most `max_chars` characters. Each chunk is TTS'd independently and the audio blobs are concatenated into the final output. This avoids hitting TTS model input limits and keeps memory bounded.

### `translate_content()`

The `POST /translate` handler. Runs the three stages in order. Each stage updates `jobs[job_id]` so a concurrent `GET /translate/<job_id>` can poll progress. Returns `201` on full success, `200` with `status: "partial"` when the transcripts are available but TTS failed mid-way, and `502`/`500` on upstream or unexpected errors.

### `get_translated_audio()`

Streams the concatenated audio bytes from `job["audio_bytes_raw"]` with the right MIME type and a `Content-Disposition: attachment` header so `curl -O` saves the file.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/translate` | Upload audio, run pipeline |
| `GET` | `/translate/<job_id>` | Get job metadata and transcripts |
| `GET` | `/translate/<job_id>/audio` | Stream dubbed audio |
| `GET` | `/languages` | List supported languages |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`. No webhooks, no tunnels.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**List languages:**

```bash
curl http://localhost:5000/languages | python3 -m json.tool
```

**Translate a Spanish clip into English:**

```bash
curl -X POST http://localhost:5000/translate \
  -F audio=@spanish-sample.mp3 \
  -F source=es \
  -F target=en
```

**Download the dubbed audio** (use the `audio_url` from the response):

```bash
curl -OJ http://localhost:5000/translate/tr-a1b2c3d4/audio
```

**Read the full transcripts:**

```bash
curl http://localhost:5000/translate/tr-a1b2c3d4 | python3 -m json.tool
```

## Going to Production

This example keeps translation jobs in memory for one hour. For production:

- **Storage** — replace the in-memory `jobs` dict with object storage (S3, GCS) for the audio blobs and a database (Postgres) for the metadata
- **Async pipeline** — run STT / translate / TTS in a queue (Celery, RQ) and have `POST /translate` enqueue and return a job id immediately
- **Long jobs** — return `202 Accepted` and let the client poll `/translate/<job_id>` until `status` is `complete`
- **Auth** — add API key validation on the upload endpoint
- **Limits** — cap upload size and reject audio longer than your STT model's limit before doing any work
- **Language detection** — switch to `source=auto` only when you trust STT's detection; pin `source` when the audio is well-known

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-content-translator-python)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
