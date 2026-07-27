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
           ├──► SMS notification
           ├──► Cloud Storage
           └──► Cloud Storage (final assets)
```

## Telnyx API Endpoints Used

- **TTS Generate (all voices)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **AI Inference (voice scoring)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)
- **Cloud Storage (S3-compatible)**: `s3.put_object(...)` via boto3 against `https://{region}.telnyxcloudstorage.com` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## How It Works

1. Sends conversation to Telnyx AI Inference for processing
2. Converts response to speech via Telnyx TTS
3. Stores results in Telnyx Cloud Storage (S3-compatible) via the AWS SDK (boto3), then returns a presigned GET URL for playback/review

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Co-located inference** - LLM runs on the same network as voice traffic. Sub-200ms round trips.
- **Integrated storage** - S3-compatible storage (accessed with the AWS SDK / boto3) co-located with voice and AI infrastructure, serving rendered takes via presigned URLs.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `MESSAGING_PROFILE_ID` | `string` | `400...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) · [CLI: `telnyx messaging-profiles`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_MODEL` | `string` | `telnyx/tts` | no | TTS model | [Docs](https://developers.telnyx.com/docs/inference) |
| `BUCKET_NAME` | `string` | `voiceovers` | no | Cloud Storage bucket | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `TELNYX_STORAGE_REGION` | `string` | `us-central-1` | no | Cloud Storage region (selects the S3 endpoint host) | [Docs](https://developers.telnyx.com/docs/cloud-storage) |

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
cd telnyx-code-examples/voiceover-audition-generator-python
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
