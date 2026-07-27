# Build an AI Video Dubbing Pipeline

Upload audio, STT transcribes it, AI Inference labels speakers and translates the dialogue to a target language, and TTS renders a dubbed audio track with speaker-matched voices. Full STT-to-TTS pipeline on Telnyx.

## How It Works

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

The pipeline runs **asynchronously**: `POST /dub` returns `202` with a `job_id`, and the client polls `GET /dub/<job_id>` until `status == "complete"`. Telnyx STT does not perform speaker diarization, so the LLM handles speaker labeling from conversational context in a single call that also produces the translations.

## Telnyx Products Used

- **Speech-to-Text (STT)** — OpenAI-compatible transcription API, Whisper-large-v3-turbo (multilingual)
- **AI Inference** — OpenAI-compatible chat-completions API, used for speaker labeling + translation
- **Text-to-Speech (TTS)** — KokoroTTS voices (e.g. `Telnyx.KokoroTTS.am_onyx`)

## API Endpoints

- **STT Transcribe**: `POST /v2/ai/audio/transcriptions` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api/text-to-speech/generate-speech-from-text)
- **TTS Voices**: `GET /v2/text-to-speech/voices` -- [ref](https://developers.telnyx.com/api/text-to-speech/list-voices)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

> **No phone number, no Call Control Application, no ngrok, no webhooks** — this is a pure HTTP API. The example uploads audio and polls for results.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-video-dubbing-pipeline-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx API key (get one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys)).

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### `start_dubbing()` — kicks off the pipeline

Validates the request, stores the job, and starts a background thread running `_run_pipeline()`.

```python
if "audio" not in request.files:
    return jsonify({"error": "Upload an audio file as 'audio'"}), 400
target_lang = request.form.get("target_language", "es")
source_lang = request.form.get("source_language", "en")
```

### `_run_pipeline()` — the 3-step pipeline (runs in background)

1. **`transcribe_audio()`** — `POST /v2/ai/audio/transcriptions` with the audio file + Whisper model id. Returns segments with `start`, `end`, `text`.
2. **`label_and_translate_segments()`** — sends all segments to the chat-completions endpoint in a single call. The LLM assigns `SPEAKER_0`, `SPEAKER_1`, ... and translates each segment. Returns a JSON array. Falls back to per-segment translation if the LLM output isn't valid JSON.
3. **`tts_generate()`** — `POST /v2/text-to-speech/speech` per segment, using a voice assigned per speaker from a KokoroTTS voice pool. Audio chunks are concatenated and stored on the job for download.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/dub` | Start dubbing (async, returns 202 + job_id) |
| `GET` | `/dub/<job_id>` | Get job status + transcript |
| `GET` | `/dub/<job_id>/audio` | Download the dubbed mp3 |
| `GET` | `/dub/<job_id>/transcript` | Get side-by-side original/translated text |
| `GET` | `/languages` | List supported languages |
| `GET` | `/jobs` | List all jobs (metadata) |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://127.0.0.1:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Start a dubbing job** (multipart form, audio file required):

```bash
curl -X POST http://localhost:5000/dub \
  -F audio=@episode.mp3 \
  -F target_language=es \
  -F source_language=en
```

**Poll job status:**

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4 | python3 -m json.tool
```

**Download the dubbed audio once `status == "complete"`:**

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/audio --output dubbed.mp3
```

**Side-by-side transcript:**

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/transcript | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage and byte-level MP3 concatenation for simplicity. For production:

- **Database** — replace the in-memory dict with PostgreSQL or Redis
- **Audio muxing** — replace byte concat with proper muxing (e.g. ffmpeg concat demuxer) so segment boundaries are sample-accurate
- **Authentication** — add API key validation on your endpoints
- **Error recovery** — retry transient STT/TTS failures with exponential backoff
- **Prompt engineering** — tune the speaker-labeling prompt for your domain (e.g. 2-person interview vs. podcast with N speakers)
- **Rate limiting** — protect `/dub` from abuse
- **Object storage** — write finished audio to Telnyx Storage and return a signed URL instead of streaming from memory

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-video-dubbing-pipeline-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Text-to-Speech docs](https://developers.telnyx.com/docs/voice/text-to-speech)
- [Telnyx Portal](https://portal.telnyx.com)
