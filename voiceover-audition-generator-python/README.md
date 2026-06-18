---
name: voiceover-audition-generator
title: "Voice-Over Audition Generator"
description: "Submit a script, hear it read by every available TTS voice. AI scores and ranks best-fit voices based on content, tone, and audience. SMS delivers top picks to decision-makers."
language: python
framework: flask
telnyx_products: [AI Inference, SMS/MMS, Cloud Storage]
---

# Voice-Over Audition Generator

Submit a script, hear it read by every available TTS voice. AI scores and ranks best-fit voices based on content, tone, and audience. SMS delivers top picks to decision-makers.

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
     SMS to customer
     Cloud Storage upload
```

## Telnyx API Endpoints Used

- **TTS Generate (all voices)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **AI Inference (voice scoring)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `MESSAGING_PROFILE_ID` | `string` | `400...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voiceover-audition-generator-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t voiceover-audition-generator-python .
docker run --env-file .env -p 5000:5000 voiceover-audition-generator-python
```

## API Reference

### `POST /auditions/create`

```bash
curl -X POST http://localhost:5000/auditions/create \
  -H "Content-Type: application/json" \
  -d '{"script": "Built for bots that talk to humans...", "project": "Brand Video", "context": "tech infrastructure commercial"}'
```

**Response:**

```json
{"audition_id": "aud-a1b2c3d4", "voices_rendered": 5, "top_pick": {"voice_id": "onyx", "score": 92, "reasoning": "Authoritative tone matches infrastructure messaging"}}
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
