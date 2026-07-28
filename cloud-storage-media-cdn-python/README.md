---
name: cloud-storage-media-cdn
title: "Cloud Storage Media CDN"
description: "Cloud Storage Media CDN - use Telnyx Cloud Storage (S3-compatible) as a CDN for IVR prompts, hold music, and voice assets."
language: python
framework: flask
telnyx_products: [Cloud Storage, Voice]
---

# Cloud Storage Media CDN

Cloud Storage Media CDN - use Telnyx Cloud Storage as a CDN for IVR prompts, hold music, announcements, and voicemail greetings. Telnyx Cloud Storage is **S3-compatible**, so this example talks to it with the AWS SDK (boto3) rather than a REST API. Media is served with presigned GET URLs you can drop straight into a TeXML `<Play>` verb or a Call Control `playback_audio` command.

## How It Works

Telnyx Cloud Storage speaks the S3 protocol, so the app uses `boto3` with two Telnyx-specific details:

1. **Region-scoped endpoint** - `https://{region}.telnyxcloudstorage.com`
2. **Auth** - your Telnyx API key is used as **both** the access key and the secret key.

Objects are organized by category prefix (`ivr_prompts/`, `hold_music/`, `announcements/`, `voicemail_greetings/`). The bucket itself is the source of truth - there is no server-side catalog to keep in sync.

```
  Client (multipart upload)
        │
        ▼
  ┌──────────────────────┐        boto3 (S3 protocol)        ┌─────────────────────────┐
  │ Flask app (app.py)    │ ────────────────────────────────► │ Telnyx Cloud Storage     │
  │  /setup /upload        │                                   │ {region}.telnyx          │
  │  /media /ivr-config    │ ◄──── presigned GET URL ───────── │  cloudstorage.com        │
  └──────────┬───────────┘                                    └─────────────────────────┘
             │ presigned URL
             ▼
  TeXML <Play> / Call Control playback_audio
```

## Telnyx Cloud Storage (S3-compatible)

This example uses the S3 protocol via boto3, not the Telnyx REST API:

- **Create bucket**: `CreateBucket` - [Cloud Storage quick start](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- **Upload object**: `PutObject` (`upload_fileobj`) - [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- **List objects**: `ListObjectsV2` - [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- **Presigned playback URL**: `generate_presigned_url("get_object", ...)` - time-limited GET URL

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key - used as both the S3 access key and secret key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `BUCKET_NAME` | `string` | `media-cdn` | no | Cloud Storage bucket name (default `media-cdn`) | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `TELNYX_STORAGE_REGION` | `string` | `us-central-1` | no | Storage region: `us-central-1`, `us-east-1`, `us-west-1`, or `eu-central-1` (default `us-central-1`) | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `PRESIGN_TTL_SECONDS` | `integer` | `3600` | no | Lifetime of presigned playback URLs in seconds (default `3600`) | - |
| `HOST` | `string` | `127.0.0.1` | no | HTTP bind host (default `127.0.0.1`) | - |
| `PORT` | `integer` | `5000` | no | HTTP server port (default `5000`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/cloud-storage-media-cdn-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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


Then create the bucket:

```bash
curl -X POST http://localhost:5000/setup
```

## API Reference

### `POST /setup`

Creates the media bucket (idempotent - safe to re-run).

```bash
curl -X POST http://localhost:5000/setup
```

**Response:**

```json
{
  "status": "ready",
  "bucket": "media-cdn",
  "categories": ["ivr_prompts", "hold_music", "announcements", "voicemail_greetings"]
}
```

### `POST /upload`

Uploads a media file. The client sends the bytes directly as `multipart/form-data` - the server never fetches an arbitrary URL.

Form fields:

| Field | Required | Description |
|-------|----------|-------------|
| `file` | **yes** | The media file bytes |
| `name` | **yes** | Object name (stored as `<category>/<name>`) |
| `category` | no | One of `ivr_prompts`, `hold_music`, `announcements`, `voicemail_greetings` (default `ivr_prompts`) |

```bash
curl -X POST http://localhost:5000/upload \
  -F file=@welcome-prompt.mp3 \
  -F name=welcome-prompt.mp3 \
  -F category=ivr_prompts
```

**Response:**

```json
{
  "status": "uploaded",
  "key": "ivr_prompts/welcome-prompt.mp3",
  "category": "ivr_prompts",
  "url": "https://us-central-1.telnyxcloudstorage.com/media-cdn/ivr_prompts/welcome-prompt.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&..."
}
```

### `GET /media`

Lists stored media, optionally filtered to one category via `?category=<cat>`.

```bash
curl "http://localhost:5000/media?category=ivr_prompts"
```

**Response:**

```json
{
  "media": [
    {
      "key": "ivr_prompts/welcome-prompt.mp3",
      "size_bytes": 48213,
      "last_modified": "2026-06-18T14:30:00+00:00"
    }
  ],
  "count": 1
}
```

### `GET /media/<category>/<name>`

Returns a presigned playback URL for a single object.

```bash
curl http://localhost:5000/media/ivr_prompts/welcome-prompt.mp3
```

**Response:**

```json
{
  "key": "ivr_prompts/welcome-prompt.mp3",
  "url": "https://us-central-1.telnyxcloudstorage.com/media-cdn/ivr_prompts/welcome-prompt.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&...",
  "expires_in": 3600
}
```

### `GET /ivr-config`

Returns presigned URLs for the `ivr_prompts` and `hold_music` sets, ready to drop into a call flow.

```bash
curl http://localhost:5000/ivr-config
```

**Response:**

```json
{
  "ivr_prompts": [
    "https://us-central-1.telnyxcloudstorage.com/media-cdn/ivr_prompts/welcome-prompt.mp3?X-Amz-..."
  ],
  "hold_music": [
    "https://us-central-1.telnyxcloudstorage.com/media-cdn/hold_music/jazz-loop.mp3?X-Amz-..."
  ],
  "usage": "Use these presigned URLs in a TeXML <Play> verb or Call Control playback_audio command."
}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "bucket": "media-cdn",
  "endpoint": "https://us-central-1.telnyxcloudstorage.com"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Abandoned Cart Recovery (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/abandoned-cart-recovery-python/README.md)
- [Accounting Tax Season Line (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/accounting-tax-season-line-python/README.md)
- [After Hours Nurse Triage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/after-hours-nurse-triage-python/README.md)
- [AI Appointment Booking SMS Flow (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-booking-sms-flow-python/README.md)
- [AI Appointment Reminder SMS Voice (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-reminder-sms-voice-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Cloud Storage quick start](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
