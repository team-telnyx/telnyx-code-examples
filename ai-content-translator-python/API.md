# AI Content Translator — API Reference

Endpoint shapes match the actual `app.py` implementation. All responses are
JSON unless noted.

## `POST /translate`

Upload an audio file and run the full STT → translate → TTS pipeline.

**Multipart form fields**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `audio` | yes | — | The audio file (mp3, wav, m4a, ogg, flac, webm) |
| `source` | no | `auto` | Source language code, or `auto` for STT auto-detect |
| `target` | no | `en` | Target language code (must be in `/languages`) |

**Example**

```bash
curl -X POST http://localhost:5000/translate \
  -F audio=@spanish-sample.mp3 \
  -F source=es \
  -F target=en
```

**Response `201`**

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
  "original_transcript_preview": "Hola, bienvenidos al episodio de hoy...",
  "translated_transcript_preview": "Hello, welcome to today's episode..."
}
```

**Response `400` — missing file**

```json
{"error": "Upload audio file as 'audio' (multipart form field)"}
```

**Response `400` — unsupported target**

```json
{
  "error": "Unsupported target language: xx",
  "supported": ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt", "zh"]
}
```

**Response `400` — no speech detected**

```json
{
  "job_id": "tr-deadbeef",
  "status": "failed",
  "error": "No speech detected in audio"
}
```

**Response `200` — partial (TTS failed on one chunk)**

```json
{
  "job_id": "tr-deadbeef",
  "status": "partial",
  "error": "TTS failed on chunk 3 of 8 (transcript still available)"
}
```

**Response `502` — upstream Telnyx error**

```json
{
  "job_id": "tr-deadbeef",
  "status": "failed",
  "error": "Telnyx API error: 401"
}
```

## `GET /translate/<job_id>`

Get a translation job with full transcripts, segments, and metadata. The audio blob is not included (use the audio endpoint for that).

**Example**

```bash
curl http://localhost:5000/translate/tr-a1b2c3d4
```

**Response `200`**

```json
{
  "job_id": "tr-a1b2c3d4",
  "status": "complete",
  "stage": "done",
  "source": "es",
  "target": "en",
  "filename": "spanish-sample.mp3",
  "created_at": "2026-07-14T18:42:00.123456+00:00",
  "completed_at": "2026-07-14T18:42:08.987654+00:00",
  "original_transcript": "Hola, bienvenidos al episodio de hoy...",
  "translated_transcript": "Hello, welcome to today's episode...",
  "segments": [
    {"index": 0, "text": "Hello, welcome...", "audio_bytes": 122880},
    {"index": 1, "text": "...", "audio_bytes": 122880}
  ],
  "audio_ready": true,
  "audio_bytes": 245760,
  "stt_segments": [...]
}
```

**Response `404`**

```json
{"error": "job not found"}
```

## `GET /translate/<job_id>/audio`

Stream the translated audio. Returns `audio/mpeg` (or whatever `TTS_FORMAT` is set to in `.env`). The response carries `Content-Disposition: attachment; filename="<job_id>.mp3"` so a browser or `curl -O` saves the file.

**Example**

```bash
curl -OJ http://localhost:5000/translate/tr-a1b2c3d4/audio
```

**Response `200`**

```text
<binary audio data>
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="tr-a1b2c3d4.mp3"
```

**Response `409` — audio not ready**

```json
{"error": "audio not ready", "status": "processing"}
```

**Response `404`**

```json
{"error": "job not found"}
```

## `GET /languages`

**Example**

```bash
curl http://localhost:5000/languages
```

**Response `200`**

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

## `GET /health`

**Example**

```bash
curl http://localhost:5000/health
```

**Response `200`**

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

## Status Values

`processing`, `complete`, `partial`, `failed`.

## Stage Values

`stt`, `tts`, `done`.

## Error Format

All errors return JSON:

```json
{"error": "message"}
```

| HTTP status | Meaning |
|-------------|---------|
| `200` | Success (also used for `partial` TTS results) |
| `201` | Created (full success — returns job metadata) |
| `400` | Bad request — missing file, unsupported language, no speech |
| `404` | Job not found |
| `409` | Audio not ready |
| `500` | Internal error (missing config, unexpected exception) |
| `502` | Upstream Telnyx API error |
