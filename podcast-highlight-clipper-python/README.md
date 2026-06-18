---
name: podcast-highlight-clipper
title: "Podcast Highlight Clipper"
description: "Upload audio, STT + AI Inference identifies viral moments with virality scoring, TTS generates teaser intros for each clip, SMS distributes highlights to subscriber list."
language: python
framework: flask
telnyx_products: [AI Inference, SMS/MMS, Media Streaming]
integrations: [Slack]
channel: [voice, api]
---

# Podcast Highlight Clipper

Upload audio, STT + AI Inference identifies viral moments with virality scoring, TTS generates teaser intros for each clip, SMS distributes highlights to subscriber list.

## Telnyx API Endpoints Used

- **STT Transcribe**: `POST /v2/ai/transcribe` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference (highlights)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (teasers)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)

## External Service Integrations

- **Slack** -- Team notifications via incoming webhooks

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
     Slack notification
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
| `SLACK_WEBHOOK` | `string` | `https://hooks.slack.com/...` | no | Slack webhook | [Docs](https://api.slack.com/messaging/webhooks) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/podcast-highlight-clipper-python
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
docker build -t podcast-highlight-clipper-python .
docker run --env-file .env -p 5000:5000 podcast-highlight-clipper-python
```

## API Reference

### `POST /clip`

Upload as multipart form:

```bash
curl -X POST http://localhost:5000/clip \
  -F audio=@recording.mp3 \
  -F title="Weekly Standup" \
  -F max_clips=5
```

**Response:**

```json
{"job_id": "clip-a1b2c3d4", "highlights": 5, "teasers_generated": 5, "sms_sent": 8, "top_highlight": {"quote": "The real cost is the latency tax", "virality_score": 9}}
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
