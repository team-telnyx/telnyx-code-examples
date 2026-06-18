---
name: multilingual-voiceover-kit
title: "Multilingual Voice-Over Kit"
description: "Submit a script in one language, AI translates to multiple targets preserving tone and timing, TTS renders each language with native-sounding voices. Batch localization for 15 languages."
language: python
framework: flask
telnyx_products: [AI Inference, Cloud Storage]
---

# Multilingual Voice-Over Kit

Submit a script in one language, AI translates to multiple targets preserving tone and timing, TTS renders each language with native-sounding voices. Batch localization for 15 languages.

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

- **AI Inference (translation)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (multilingual)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
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
cd telnyx-code-examples/multilingual-voiceover-kit-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t multilingual-voiceover-kit-python .
docker run --env-file .env -p 5000:5000 multilingual-voiceover-kit-python
```

## API Reference

### `POST /kits/create`

```bash
curl -X POST http://localhost:5000/kits/create \
  -H "Content-Type: application/json" \
  -d '{"script": "Welcome to Telnyx...", "target_languages": ["es", "fr", "de", "ja", "ar"], "project": "Product Launch"}'
```

**Response:**

```json
{"kit_id": "kit-a1b2c3d4", "languages_rendered": 6, "languages_total": 6}
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
