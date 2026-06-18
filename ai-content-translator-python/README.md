---
name: ai-content-translator
title: "AI Content Translator"
description: "Upload any audio (podcast, meeting, lecture), STT transcribes in source language, AI Inference translates, TTS generates audio in target language. Returns translated audio + aligned transcript."
language: python
framework: flask
telnyx_products: [AI Inference, Media Streaming]
integrations: []
channel: [voice, api]
---

# AI Content Translator

Upload any audio (podcast, meeting, lecture), STT transcribes in source language, AI Inference translates, TTS generates audio in target language. Returns translated audio + aligned transcript.

## Telnyx API Endpoints Used

- **STT Transcribe**: `POST /v2/ai/transcribe` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)

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
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model name | [Docs](https://developers.telnyx.com/docs/inference) |
| `STT_MODEL` | `string` | `telnyx/asr` | no | STT model name | [Docs](https://developers.telnyx.com/docs/inference) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-content-translator-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Webhook Configuration

```bash
ngrok http 5000
```

Set webhook URL in [Telnyx Portal](https://portal.telnyx.com):
- Call Control Application -> `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t ai-content-translator-python .
docker run --env-file .env -p 5000:5000 ai-content-translator-python
```

## API Reference

### `POST /translate`

Upload as multipart form:

```bash
curl -X POST http://localhost:5000/translate \
  -F audio=@lecture.mp3 \
  -F source=en \
  -F target=ja
```

**Response:**

```json
{"job_id": "tr-a1b2c3d4", "status": "complete", "source": "en (English)", "target": "ja (Japanese)", "original_length": 1847, "translated_length": 923}
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
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
