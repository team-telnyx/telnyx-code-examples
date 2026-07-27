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
  API Request
        │
        ▼
  ┌──────────────────┐
  │ AI Inference      │ ── translate + adapt tone
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

- **AI Inference (translation)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (multilingual)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage (S3-compatible)**: `boto3.put_object(Bucket, Key, Body, ...)` against `https://{region}.telnyxcloudstorage.com` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## How It Works

1. Sends conversation to Telnyx AI Inference for processing
2. Converts response to speech via Telnyx TTS
3. Stores results in Telnyx Cloud Storage via the S3-compatible API (boto3) and returns a presigned GET URL for playback

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Co-located inference** - LLM runs on the same network as voice traffic. Sub-200ms round trips.
- **Integrated storage** - S3-compatible storage co-located with voice and AI infrastructure. Rendered audio is uploaded with the AWS SDK (boto3) and served via presigned GET URLs.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `TELNYX_STORAGE_REGION` | `string` | `us-central-1` | no | Cloud Storage region (selects the S3 endpoint host) | [Docs](https://developers.telnyx.com/docs/cloud-storage) |

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
cd telnyx-code-examples/multilingual-voiceover-kit-python
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
