---
name: podcast-episode-repurposer
title: "Podcast Episode Repurposer"
description: "Upload a recorded episode, STT transcribes, AI Inference extracts key quotes and topics, TTS generates audiogram clips with different voices, SMS distributes clips to subscribers."
language: python
framework: flask
telnyx_products: [AI Inference, SMS/MMS, Media Streaming]
integrations: []
channel: [voice, api]
---

# Podcast Episode Repurposer

Upload a recorded episode, STT transcribes, AI Inference extracts key quotes and topics, TTS generates audiogram clips with different voices, SMS distributes clips to subscribers.

## Telnyx API Endpoints Used

- **STT Transcribe**: `POST /v2/ai/transcribe` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)

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

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `MESSAGING_PROFILE_ID` | `string` | `400...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model name | [Docs](https://developers.telnyx.com/docs/inference) |
| `STT_MODEL` | `string` | `telnyx/asr` | no | STT model name | [Docs](https://developers.telnyx.com/docs/inference) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/podcast-episode-repurposer-python
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
docker build -t podcast-episode-repurposer-python .
docker run --env-file .env -p 5000:5000 podcast-episode-repurposer-python
```

## API Reference

### `POST /repurpose`

Upload as multipart form:

```bash
curl -X POST http://localhost:5000/repurpose \
  -F audio=@episode.mp3 \
  -F title="AI Infrastructure Deep Dive"
```

**Response:**

```json
{"job_id": "rep-a1b2c3d4", "status": "complete", "quotes_extracted": 5, "clips_generated": 5, "social_posts": 3, "sms_sent": 12}
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
