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
  API Request
        │
        ▼
  ┌──────────────────┐
  │ AI Inference      │ ── direction cues, rewrites
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ TTS Generation    │ ── render audio
  │ (multiple takes/  │
  │  voices/languages)│
  └────────┬─────────┘
           │
           ├──► SMS notification
           └──► Download / stream
```

## How It Works

1. Sends conversation to Telnyx AI Inference for processing
2. Converts response to speech via Telnyx TTS

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Co-located inference** - LLM runs on the same network as voice traffic. Sub-200ms round trips.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `MESSAGING_PROFILE_ID` | `string` | `400...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) · [CLI: `telnyx messaging-profiles`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model name | [Docs](https://developers.telnyx.com/docs/inference) |
| `STT_MODEL` | `string` | `telnyx/asr` | no | STT model name | [Docs](https://developers.telnyx.com/docs/inference) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> telnyx messaging-profiles create --name my-profile
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/podcast-episode-repurposer-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


### Webhook Configuration

```bash
ngrok http 5000
```

Set webhook URL in [Telnyx Portal](https://portal.telnyx.com):
- Call Control Application -> `https://<id>.ngrok.io/webhooks/voice`

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

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Unauthorized**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **AI response slow/empty**: Verify model name. See available models at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/list-models).

## Related Examples

- [run-llm-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) - Standalone inference
- [build-voice-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) - Voice AI agent

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
