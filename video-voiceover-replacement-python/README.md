---
name: video-voiceover-replacement
title: "Video Voice-Over Replacement"
description: "Upload audio with existing voice-over. STT extracts the script, AI rewrites/improves it (5 modes: polish, professional, simplify, energize, shorten), TTS re-records with studio quality."
language: python
framework: flask
telnyx_products: [AI Inference, Media Streaming]
---

# Video Voice-Over Replacement

Upload audio with existing voice-over. STT extracts the script, AI rewrites/improves it (5 modes: polish, professional, simplify, energize, shorten), TTS re-records with studio quality.

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
     Cloud Storage upload
```

## Telnyx API Endpoints Used

- **STT Transcribe**: `POST /v2/ai/transcribe` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference (rewrite)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `STT_MODEL` | `string` | `telnyx/asr` | no | STT model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-voiceover-replacement-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t video-voiceover-replacement-python .
docker run --env-file .env -p 5000:5000 video-voiceover-replacement-python
```

## API Reference

### `POST /replace`

Upload as multipart form:

```bash
curl -X POST http://localhost:5000/replace \
  -F audio=@input.mp3 \
  -F mode=professional
```

**Response:**

```json
{"job_id": "rep-a1b2c3d4", "mode": "professional", "original_word_count": 234, "improved_word_count": 218, "change_pct": -6.8}
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
