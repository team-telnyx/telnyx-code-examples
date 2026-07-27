---
name: cloud-storage-call-archive
title: "Cloud Storage Call Archive"
description: "Cloud Storage Call Archive - archive call recordings to Telnyx Cloud Storage (S3-compatible) with searchable metadata."
language: python
framework: flask
telnyx_products: [Cloud Storage, Voice, Call Recording]
---

# Cloud Storage Call Archive

Cloud Storage Call Archive - archive call recordings to Telnyx Cloud Storage with searchable metadata.

Telnyx Cloud Storage is **S3-compatible**, so this example uploads with the AWS SDK (`boto3`) pointed at the Telnyx S3 endpoint (`https://{region}.telnyxcloudstorage.com`). The Telnyx API key is supplied as **both** the access key and the secret key. Recordings are downloaded from their Telnyx recording URL over HTTPS (using `requests`) and then stored in the bucket with their metadata attached to the object.

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.recording.saved` - Call recording saved; the `recording_urls.mp3` URL is queued for archival.

## Architecture

```
  call.recording.saved          POST /archive
        │                              │
        ▼                              ▼
  ┌──────────────────┐        ┌──────────────────┐
  │ Webhook handler  │        │ Download recording│
  │ (queue metadata) │        │ from Telnyx (HTTPS)│
  └──────────────────┘        └────────┬─────────┘
                                        │ boto3 put_object
                                        ▼
                          Telnyx Cloud Storage (S3-compatible)
                       https://{region}.telnyxcloudstorage.com
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key; used as both S3 access key and secret key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `BUCKET_NAME` | `string` | `call-archive` | no | Telnyx Cloud Storage bucket name (default `call-archive`) | [Portal](https://portal.telnyx.com/storage) · [CLI: `telnyx storage`](https://developers.telnyx.com/development/cli) |
| `TELNYX_STORAGE_REGION` | `string` | `us-central-1` | no | Storage region: `us-central-1` \| `us-east-1` \| `us-west-1` \| `eu-central-1` (default `us-central-1`) | [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage/quick-start) |
| `HOST` | `string` | `127.0.0.1` | no | HTTP bind address (default `127.0.0.1`) | - |
| `PORT` | `integer` | `5000` | no | HTTP server port (default `5000`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/cloud-storage-call-archive-python
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


Create the bucket once on startup:

```bash
curl -X POST http://localhost:5000/buckets
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/recording`

## API Reference

### `POST /buckets`

Create the archive bucket (idempotent - an existing bucket you own is treated as success).

```bash
curl -X POST http://localhost:5000/buckets
```

**Response:**

```json
{
  "status": "ready",
  "bucket": "call-archive"
}
```

### `GET /buckets`

List the buckets in your Telnyx Cloud Storage account.

```bash
curl http://localhost:5000/buckets
```

**Response:**

```json
{
  "buckets": ["call-archive"]
}
```

### `POST /archive`

Download a recording from its Telnyx URL and store it in the bucket. The `recording_url` **must be an `https` Telnyx URL** (`telnyx.com` or a `*.telnyx.com` host) - any other URL is rejected so the API key is never sent to an attacker-supplied host.

```bash
curl -X POST http://localhost:5000/archive \
  -H "Content-Type: application/json" \
  -d '{
    "recording_url": "https://api.telnyx.com/v2/recordings/abc123/download.mp3",
    "call_id": "call-abc123",
    "metadata": {"agent": "alice", "campaign": "summer-sale"}
  }'
```

**Response:**

```json
{
  "status": "archived",
  "entry": {
    "call_id": "call-abc123",
    "object_key": "2026/06/18/call-abc123.mp3",
    "bucket": "call-archive",
    "size_bytes": 184320,
    "metadata": {"agent": "alice", "campaign": "summer-sale"},
    "archived_at": "2026-06-18T14:30:00Z"
  }
}
```

### `GET /archive`

List archived recordings, optionally filtered by date (`YYYY/MM/DD`, matched against the object key).

```bash
curl "http://localhost:5000/archive?date=2026/06/18"
```

**Response:**

```json
{
  "recordings": [
    {
      "call_id": "call-abc123",
      "object_key": "2026/06/18/call-abc123.mp3",
      "bucket": "call-archive",
      "size_bytes": 184320,
      "metadata": {"agent": "alice", "campaign": "summer-sale"},
      "archived_at": "2026-06-18T14:30:00Z"
    }
  ],
  "total": 1
}
```

### `GET /archive/search`

Full-text search across the in-memory metadata index. The query `q` is matched (case-insensitive) against the JSON of each entry.

```bash
curl "http://localhost:5000/archive/search?q=alice"
```

**Response:**

```json
{
  "results": [
    {
      "call_id": "call-abc123",
      "object_key": "2026/06/18/call-abc123.mp3",
      "bucket": "call-archive",
      "size_bytes": 184320,
      "metadata": {"agent": "alice", "campaign": "summer-sale"},
      "archived_at": "2026-06-18T14:30:00Z"
    }
  ],
  "query": "alice"
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
  "archived": 1,
  "bucket": "call-archive"
}
```

## Webhook Endpoints

### `POST /webhooks/recording`

Receives Telnyx Call Control webhooks. On `call.recording.saved`, it reads `data.payload.recording_urls.mp3` and queues an entry (with `call_control_id` and `recording_duration_millis`) in the metadata index for later archival.

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

- [Branded Caller Id Manager (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md)
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md)
- [Build IVR Phone Menu (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md)
- [Bulk Number Validation Cleaner (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md)
- [Call Analytics Dashboard Api (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Cloud Storage quick start](https://developers.telnyx.com/docs/cloud-storage/quick-start)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
