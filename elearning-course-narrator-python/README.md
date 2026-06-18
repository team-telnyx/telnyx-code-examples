---
name: elearning-course-narrator
title: "E-Learning Course Narrator"
description: "Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest."
language: python
framework: flask
telnyx_products: [AI Inference, Cloud Storage]
---

# E-Learning Course Narrator

Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest.

## Architecture

```
  Input (script/text)
        │
        ▼
  ┌─────────────────┐
  │  AI Inference    │ ── process / direct / rewrite
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  TTS Generation  │ ── render audio (multiple takes/voices)
  └────────┬────────┘
           │
           ▼
     Email notification
     Cloud Storage upload
```

## Telnyx API Endpoints Used

- **AI Inference (course structure)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (narration)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) |
| `DEFAULT_VOICE` | `string` | `alloy` | no | Default voice | [Docs](https://developers.telnyx.com/docs/inference) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/elearning-course-narrator-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t elearning-course-narrator-python .
docker run --env-file .env -p 5000:5000 elearning-course-narrator-python
```

## API Reference

### `POST /courses/create`

```bash
curl -X POST http://localhost:5000/courses/create \
  -H "Content-Type: application/json" \
  -d '{"title": "Voice AI Fundamentals", "content": "Lesson 1: Understanding TTS...", "include_quizzes": true}'
```

**Response:**

```json
{"course_id": "course-a1b2c3d4", "modules": 5, "total_audio_mb": 8.3, "total_est_minutes": 22}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{"status": "ok"}
```

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Cloud Storage Docs](https://developers.telnyx.com/docs/cloud-storage)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
