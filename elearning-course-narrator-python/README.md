---
name: elearning-course-narrator
title: "E-Learning Course Narrator"
description: "Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest."
language: python
framework: flask
telnyx_products: [AI Inference, Cloud Storage]
---

# E-Learning Course Narrator

Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest.

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ AI Inference      │ ── score + rank voice fits
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ TTS Generation    │ ── render audio
  │ (multiple takes/  │
  │  voices/languages)│
  └────────┬─────────┘
           │
           ├──► Cloud Storage
           └──► Cloud Storage (final assets)
```

## Telnyx API Endpoints Used

- **AI Inference (course structure)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (narration)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage**: S3-compatible - accessed with the AWS SDK (boto3) against `https://{region}.telnyxcloudstorage.com` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## How It Works

1. Sends conversation to Telnyx AI Inference for processing
2. Converts response to speech via Telnyx TTS
3. Stores results in Telnyx Cloud Storage (S3-compatible) via boto3 and returns a presigned GET URL for each asset

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Co-located inference** - LLM runs on the same network as voice traffic. Sub-200ms round trips.
- **Integrated storage** - S3-compatible storage co-located with voice and AI infrastructure. Use any AWS SDK (here, boto3) against the region endpoint, authenticating with your Telnyx API key as both the access and secret key, and hand out presigned GET URLs for playback.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `TELNYX_STORAGE_REGION` | `string` | `us-central-1` | no | Cloud Storage region (selects the S3 endpoint host: `us-central-1`, `us-east-1`, `us-west-1`, `eu-central-1`) | [Docs](https://developers.telnyx.com/docs/cloud-storage) |
| `DEFAULT_VOICE` | `string` | `alloy` | no | Default voice | [Docs](https://developers.telnyx.com/docs/inference) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/elearning-course-narrator-python
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


## API Reference

### `POST /courses/create`

```bash
curl -X POST http://localhost:5000/courses/create \
  -H "Content-Type: application/json" \
  -d '{"title": "Voice AI Fundamentals", "content": "Lesson 1: Understanding TTS...", "include_quizzes": true}'
```

**Response:**

```json
{"course_id": "course-a1b2c3d4", "modules": 5, "total_audio_mb": 8.3, "total_est_minutes": 22}
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
- [Cloud Storage Docs](https://developers.telnyx.com/docs/cloud-storage)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
