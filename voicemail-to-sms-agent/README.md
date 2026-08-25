---
name: voicemail-to-sms-agent
title: "Voicemail-to-SMS Agent"
description: "Automatically transcribe, summarize, and text voicemail summaries to your phone using Telnyx Call Control, AI Inference, Messaging, and Cloud Storage."
language: python
framework: flask
telnyx_products: [Call Control, AI Inference, Messaging, Cloud Storage]
---

# Voicemail-to-SMS Agent

Never check voicemail again. This Flask app listens for Telnyx Call Control voicemail webhooks, downloads the audio, transcribes and summarizes it with Telnyx AI Inference, texts the summary to your phone via Telnyx Messaging, and archives the original audio to Telnyx Cloud Storage.

## Why Telnyx

Telnyx provides a unified AI Communications Infrastructure platform that lets you programmatically control calls, run AI inference, send SMS, and store media—all behind a single API and SDK. This sample stitches four Telnyx primitives together in under 200 lines of Python so you can ship a "voicemail-to-SMS" workflow in an afternoon instead of wiring up four separate vendors.

## Telnyx API Endpoints Used

| Primitive | Telnyx SDK call | Purpose |
|-----------|-----------------|---------|
| Call Control | `telnyx.Webhook.construct_event()` | Verify Ed25519-signed voicemail webhook |
| AI Inference (STT) | `telnyx.ai.openai.audio.create_transcription()` | Transcribe voicemail audio to text |
| AI Inference (LLM) | `telnyx.ai.openai.chat.create_completion()` | Summarize transcript into an SMS-sized message |
| Messaging | `telnyx.Message.create()` | Send the summary SMS to the mailbox owner |
| Cloud Storage | `telnyx.storage.object.create()` | Archive the original voicemail audio |

## Architecture

```
┌──────────────┐    webhook     ┌──────────────────────┐
│  Telnyx Call │  (call.status  │  Flask webhook       │
│  Control     │  = voicemail)  │  /webhooks/voicemail │
└──────────────┘ ─────────────► └──────────┬───────────┘
                                          │ verify Ed25519
                                          ▼
                                 ┌──────────────────────┐
                                 │  VoicemailAgent      │
                                 │  .onTask(payload)    │
                                 └──────────┬───────────┘
                                            │
            ┌───────────────────────────────┼───────────────────────────────┐
            ▼                               ▼                               ▼
  ┌──────────────────┐         ┌──────────────────────┐         ┌────────────────────┐
  │ Download audio   │         │ STT + LLM summarize  │         │ SMS summary        │
  │ (requests.get)   │ ──────► │ via Telnyx AI        │ ──────► │ via telnyx.Message │
  └──────────────────┘         └──────────────────────┘         └────────────────────┘
                                            │
                                            ▼
                              ┌────────────────────────┐
                              │ Archive audio to        │
                              │ Telnyx Cloud Storage    │
                              └────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_APP_NAME` | `string` | `your_telnyx_app_name_here` | **yes** | TELNYX_APP_NAME | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `TELNYX_STORAGE_BUCKET` | `string` | `your_telnyx_storage_bucket_here` | **yes** | TELNYX_STORAGE_BUCKET | — |
| `TELNYX_TO_NUMBER` | `string` | `your_telnyx_to_number_here` | **yes** | TELNYX_TO_NUMBER | — |

## Setup

```bash
# 1. Clone the repo and navigate to the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-to-sms-agent

# 2. Create a virtual environment and activate it
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy the example env file and fill in your credentials
cp .env.example .env
# Edit .env with your Telnyx API key, public key, from/to numbers, and storage bucket

# 5. Run the Flask app
python app.py
```

Expose your local server to the public internet (e.g. with `ngrok http 5000`) and register the resulting URL plus `/webhooks/voicemail` as your Call Control webhook in the Telnyx Mission Control Portal.

## API Reference

See [API.md](./API.md) for the full typed endpoint reference, including request/response shapes and status codes for the `/webhooks/voicemail` and `/health` routes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` on webhook | Ed25519 signature verification failed | Confirm `TELNYX_PUBLIC_KEY` matches the public key in your Telnyx portal and that you're passing the raw request body to `telnyx.Webhook.construct_event`. |
| `No recording URL present` log | Webhook fired before recording was ready | Ensure your Call Control application is configured to send `call.status = voicemail` events with `recording_urls` populated. |
| STT returns empty transcript | Audio format unsupported or download failed | Verify the recording URL is reachable and the audio is in a Whisper-compatible format (wav/mp3). |
| SMS not received | Missing or unverified numbers | Check that `TELNYX_FROM_NUMBER` is a Telnyx messaging-enabled number and `TELNYX_TO_NUMBER` is a valid E.164 mobile number. |
| Cloud Storage archive skipped | `TELNYX_STORAGE_BUCKET` not set | Create a bucket in Telnyx Cloud Storage and set the env var to its name. |
| `telnyx` module errors | SDK version mismatch | Reinstall with `pip install telnyx>=2.0`. |

## Agent Discovery

- [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Control quickstart](https://github.com/team-telnyx/telnyx-code-examples) — inbound call handling basics
- [AI Inference chat completions](https://github.com/team-telnyx/telnyx-code-examples) — LLM calls via Telnyx
- [SMS send/receive](https://github.com/team-telnyx/telnyx-code-examples) — Messaging API fundamentals
- [Cloud Storage uploads](https://github.com/team-telnyx/telnyx-code-examples) — object storage with Telnyx

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/docs)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/calls)
- [AI Inference API Reference](https://developers.telnyx.com/docs/api/ai)
- [Messaging API Reference](https://developers.telnyx.com/docs/api/v2/messaging)
- [Cloud Storage API Reference](https://developers.telnyx.com/docs/api/v2/storage)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
