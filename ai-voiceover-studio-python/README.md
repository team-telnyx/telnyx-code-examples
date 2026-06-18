---
name: ai-voiceover-studio
title: "AI Voice-Over Studio"
description: "Upload a script, select voice/style/pacing, AI adds professional direction cues (pauses, emphasis, pacing), TTS renders the voice-over, stores output in Cloud Storage. Supports multiple takes and retakes."
language: python
framework: flask
telnyx_products: [AI Inference, Cloud Storage]
---

# AI Voice-Over Studio

Upload a script, select voice/style/pacing, AI adds professional direction cues (pauses, emphasis, pacing), TTS renders the voice-over, stores output in Cloud Storage. Supports multiple takes and retakes.

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

- **AI Inference (direction)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-voiceover-studio-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t ai-voiceover-studio-python .
docker run --env-file .env -p 5000:5000 ai-voiceover-studio-python
```

## API Reference

### `POST /projects/create`

```bash
curl -X POST http://localhost:5000/projects/create \
  -H "Content-Type: application/json" \
  -d '{"script": "Telnyx owns the entire stack...", "voice": "warm_narrator", "style": "corporate", "takes": 2}'
```

**Response:**

```json
{"project_id": "vo-a1b2c3d4", "voice": "warm_narrator (Warm, approachable female)", "style": "corporate", "takes_rendered": 2}
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
