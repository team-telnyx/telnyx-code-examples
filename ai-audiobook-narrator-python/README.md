---
name: ai-audiobook-narrator
title: "AI Audiobook Narrator"
description: "Submit text, AI Inference chunks into chapters with pacing/emotion markup, TTS narrates each chapter with consistent voice, stores final audio in Telnyx Cloud Storage."
language: python
framework: flask
telnyx_products: [AI Inference, Cloud Storage]
integrations: []
channel: [voice, api]
---

# AI Audiobook Narrator

Submit text, AI Inference chunks into chapters with pacing/emotion markup, TTS narrates each chapter with consistent voice, stores final audio in Telnyx Cloud Storage.

## Telnyx API Endpoints Used

- **AI Inference (chapter split)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (narration)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage Upload**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

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

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model name | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `audiobooks` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) |
| `DEFAULT_VOICE` | `string` | `nova` | no | Default narrator voice | [Docs](https://developers.telnyx.com/docs/inference) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-audiobook-narrator-python
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
docker build -t ai-audiobook-narrator-python .
docker run --env-file .env -p 5000:5000 ai-audiobook-narrator-python
```

## API Reference

### `POST /books/narrate`

```bash
curl -X POST http://localhost:5000/books/narrate \
  -H "Content-Type: application/json" \
  -d '{"title": "The Future of Infrastructure", "text": "Chapter 1: The shift from...", "voice": "nova"}'
```

**Response:**

```json
{"book_id": "book-a1b2c3d4", "title": "The Future of Infrastructure", "chapters": 5, "total_audio_mb": 12.4, "storage_urls": ["https://storage.telnyx.com/audiobooks/book-a1b2c3d4/chapter-01.mp3"]}
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
