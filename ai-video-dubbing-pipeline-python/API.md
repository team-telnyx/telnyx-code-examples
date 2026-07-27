## `POST /dub`

Start a dubbing job asynchronously. Upload audio as multipart form with `audio` file, `target_language`, and optional `source_language` (default: `en`).

### Request

Multipart form fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | file | yes | Audio file to dub (mp3, wav, m4a, etc.) |
| `target_language` | string | no | Target language code (default: `es`). See `GET /languages`. |
| `source_language` | string | no | Source language code (default: `en`) |

### Response `202`

```json
{
  "job_id": "dub-a1b2c3d4",
  "status": "queued",
  "source_language": "en",
  "target_language": "es (Spanish)",
  "message": "Pipeline started. Poll GET /dub/<job_id> for status."
}
```

### Response `400`

```json
{"error": "Upload an audio file as 'audio'"}
```

```json
{"error": "Unsupported target language: xx", "supported": {"es": "Spanish", "fr": "French", "...": "..."}}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/dub \
  -F audio=@episode.mp3 \
  -F target_language=es \
  -F source_language=en
```

---

## `GET /dub/<job_id>`

Get dubbing job status and results (without the audio payload).

### Response `200`

```json
{
  "id": "dub-a1b2c3d4",
  "status": "complete",
  "source_language": "en",
  "target_language": "es",
  "target_language_name": "Spanish",
  "created_at": "2026-07-27T10:00:00.000000",
  "completed_at": "2026-07-27T10:01:30.000000",
  "transcript": {
    "text": "Hello and welcome to the show.",
    "segments": [{"start": 0.0, "end": 2.5, "text": "Hello and welcome to the show."}]
  },
  "translated_segments": [
    {
      "speaker": "SPEAKER_0",
      "original": "Hello and welcome to the show.",
      "translated": "Hola y bienvenidos al programa.",
      "start": 0.0,
      "end": 2.5
    }
  ],
  "dubbed_segments": [
    {
      "speaker": "SPEAKER_0",
      "voice": "Telnyx.KokoroTTS.am_onyx",
      "text": "Hola y bienvenidos al programa.",
      "audio_size_bytes": 24832,
      "start": 0.0,
      "end": 2.5
    }
  ],
  "speaker_voice_map": {"SPEAKER_0": "Telnyx.KokoroTTS.am_onyx"},
  "error": null
}
```

Statuses: `queued`, `transcribing`, `translating`, `synthesizing`, `complete`, `failed`.

### Response `404`

```json
{"error": "Job not found"}
```

**Try it:**

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4 | python3 -m json.tool
```

---

## `GET /dub/<job_id>/audio`

Download the dubbed audio track as an mp3 file. Only available when `status == "complete"`.

### Response `200` (`audio/mpeg`)

Binary mp3 stream with `Content-Disposition: attachment; filename="dub-<id>.mp3"`.

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/audio --output dubbed.mp3
```

### Response `404`

```json
{"error": "Job not found"}
```

### Response `409`

```json
{"error": "Job not complete (status: translating)"}
```

---

## `GET /dub/<job_id>/transcript`

Get side-by-side original and translated text for each segment.

### Response `200`

```json
{
  "job_id": "dub-a1b2c3d4",
  "source": "en",
  "target": "es",
  "segments": [
    {
      "speaker": "SPEAKER_0",
      "original": "Hello and welcome to the show.",
      "translated": "Hola y bienvenidos al programa.",
      "timestamp": "0.0s - 2.5s"
    }
  ]
}
```

### Response `404`

```json
{"error": "Job not found"}
```

**Try it:**

```bash
curl http://localhost:5000/dub/dub-a1b2c3d4/transcript | python3 -m json.tool
```

---

## `GET /languages`

List supported dubbing target languages.

### Response `200`

```json
{
  "languages": {
    "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese",
    "it": "Italian", "ja": "Japanese", "ko": "Korean", "zh": "Chinese",
    "ar": "Arabic", "hi": "Hindi", "ru": "Russian", "nl": "Dutch",
    "sv": "Swedish", "pl": "Polish", "tr": "Turkish"
  }
}
```

**Try it:**

```bash
curl http://localhost:5000/languages
```

---

## `GET /jobs`

List all dubbing jobs (metadata only, no audio/transcript payloads).

### Response `200`

```json
{
  "jobs": [
    {
      "id": "dub-a1b2c3d4",
      "status": "complete",
      "source": "en",
      "target": "es",
      "segments": 5,
      "created_at": "2026-07-27T10:00:00.000000"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/jobs
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "total_jobs": 1,
  "active": 0,
  "supported_languages": 15,
  "version": "1.0.0"
}
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Status Values

Jobs move through these statuses: `queued` → `transcribing` → `translating` → `synthesizing` → `complete`. On error at any step, the status becomes `failed` and the `error` field is populated.

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `202` | Accepted — async job started, poll for results |
| `400` | Bad request — missing or invalid fields |
| `404` | Resource not found |
| `409` | Conflict — e.g. requesting audio before job is complete |
| `500` | Server error |
