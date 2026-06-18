---
name: commercial-voiceover-generator
title: "Commercial Voice-Over Generator"
description: "Provide product name, target audience, and tone. AI writes 3 script variations with timing marks, TTS renders each in multiple voices, delivers top picks via SMS for client approval."
language: python
framework: flask
telnyx_products: [AI Inference, SMS/MMS]
---

# Commercial Voice-Over Generator

Provide product name, target audience, and tone. AI writes 3 script variations with timing marks, TTS renders each in multiple voices, delivers top picks via SMS for client approval.

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
```

## Telnyx API Endpoints Used

- **AI Inference (copywriting)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `MESSAGING_PROFILE_ID` | `string` | `400...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/commercial-voiceover-generator-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

### Docker

```bash
docker build -t commercial-voiceover-generator-python .
docker run --env-file .env -p 5000:5000 commercial-voiceover-generator-python
```

## API Reference

### `POST /commercials/generate`

```bash
curl -X POST http://localhost:5000/commercials/generate \
  -H "Content-Type: application/json" \
  -d '{"product": "Telnyx Voice AI", "audience": "enterprise developers", "tone": "professional", "length": "30s", "cta": "Start building at telnyx.com"}'
```

**Response:**

```json
{"campaign_id": "cm-a1b2c3d4", "scripts": 3, "renders": 6, "length": "30s", "tone": "professional"}
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
