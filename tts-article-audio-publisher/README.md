---
name: tts-article-audio-publisher
title: "TTS Article-to-Audio Publisher with Storage"
description: "A scheduled Flask app that detects new/updated articles in SQLDB, generates narrated audio via Telnyx TTS, publishes to Storage with versioned CDN URLs, and tracks versions in KV."
language: python
framework: flask
telnyx_products: [Functions, SQLDB, Voice, Storage, KV]
---

# TTS Article-to-Audio Publisher with Storage

A scheduled Telnyx Function (Flask) that detects new or updated articles in SQLDB, generates narrated audio via Text-to-Speech, publishes each file to Storage under a versioned object key with a public CDN URL, and tracks article-to-version mappings in KV for targeted regeneration.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a unified platform for building, deploying, and scaling real-time communication applications. Unlike fragmented stacks that require stitching together separate TTS engines, object stores, databases, and key-value caches, Telnyx offers native primitives (Voice TTS, Storage, SQLDB, KV) that work together seamlessly. This sample demonstrates how a publisher can go from article content to a publicly addressable audio file using only Telnyx-managed services, with no self-hosted infrastructure, job queues, or CDN pipelines to maintain.

## Telnyx API Endpoints Used

| Telnyx Product | SDK Method / Endpoint | Purpose |
|----------------|----------------------|---------|
| **Voice (TTS)** | `telnyx.voice.TextToSpeech.create(text, voice, model)` | Synthesize narrated audio from article body text |
| **Storage** | `telnyx.storage.objects.upload(bucket, key, body, content_type)` | Upload audio bytes to a versioned object key |
| **KV** | `telnyx.kv.get(key)`, `telnyx.kv.put(key, value)` | Store and retrieve article content hashes for change detection |
| **SQLDB** | `psycopg2.connect(SQLDB_CONNECTION_STRING)` | Query the articles table for new or updated content |
| **Functions** | Flask `/schedule` POST route (cron trigger) | Scheduled entry point invoked by Telnyx Function cron |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telnyx Function (Flask)                      │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   /schedule  │───▶│   run_cycle()│───▶│  diff_articles()│         │
│  │  (cron POST) │    │              │    │  (compare KV) │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                              │                                    │
│                              ▼                                    │
│                    ┌────────────────────┐                         │
│                    │  fetch_articles()  │                         │
│                    │  (SQLDB query)     │                         │
│                    └────────────────────┘                         │
│                              │                                    │
│                    ┌─────────┴─────────┐                          │
│                    │  For each changed │                          │
│                    │  article:         │                          │
│                    └─────────┬─────────┘                          │
│                              ▼                                    │
│                    ┌────────────────────┐                         │
│                    │  synthesize_tts()  │                         │
│                    │  (Voice TTS)       │                         │
│                    └────────────────────┘                         │
│                              │                                    │
│                              ▼                                    │
│                    ┌────────────────────┐                         │
│                    │publish_to_storage()│                         │
│                    │  (Storage upload)  │                         │
│                    └────────────────────┘                         │
│                              │                                    │
│                              ▼                                    │
│                    ┌────────────────────┐                         │
│                    │ verify_cdn_url()   │                         │
│                    │  (HTTP HEAD check) │                         │
│                    └────────────────────┘                         │
│                              │                                    │
│                              ▼                                    │
│                    ┌────────────────────┐                         │
│                    │ set_stored_version()│                        │
│                    │  (KV put)          │                         │
│                    └────────────────────┘                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  SQLDB   │     │   Voice  │     │ Storage  │     │    KV    │
  │ articles │     │   TTS    │     │  bucket  │     │ namespace│
  │  table   │     │          │     │          │     │          │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

**Data flow:**
1. Cron trigger hits `/schedule` → `run_cycle()` is invoked
2. `fetch_articles()` queries SQLDB for all articles
3. `diff_articles()` compares each article's `content_hash` against the value stored in KV (`tts:article_version:<article_id>`)
4. Only new or changed articles proceed to `synthesize_tts()` (Voice TTS)
5. Audio bytes are uploaded to Storage at `tts-audio/<article_id>/<content_hash>.mp3`
6. `verify_cdn_url()` performs an HTTP HEAD to confirm the CDN URL returns `audio/*` with HTTP 200
7. On success, `set_stored_version()` writes the new hash to KV, completing the cache key update
8. The cycle is idempotent — re-running with unchanged articles produces zero TTS calls and zero uploads

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CDN_BASE_URL` | `string` | `your_cdn_base_url_here` | **yes** | Base URL for the Storage CDN endpoint | Telnyx Portal → Storage → CDN |
| `CRON_SCHEDULE` | `string` | `your_cron_schedule_here` | **yes** | Cron expression for scheduled runs (default: `0 * * * *`) | Telnyx Portal → Functions → Schedules |
| `KV_NAMESPACE` | `string` | `your_kv_namespace_here` | **yes** | KV namespace ID for version tracking | Telnyx Portal → KV → Namespaces |
| `PORT` | `string` | `your_port_here` | **yes** | Port for the Flask server to listen on (default: `8080`) | Local configuration |
| `SQLDB_CONNECTION_STRING` | `string` | `your_sqldb_connection_string_here` | **yes** | PostgreSQL or SQLite connection string for the articles database | Telnyx Portal → SQLDB |
| `STORAGE_BUCKET` | `string` | `your_storage_bucket_here` | **yes** | Name of the Storage bucket for audio files | Telnyx Portal → Storage → Buckets |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key for authenticating SDK calls | Telnyx Portal → API Keys |
| `TTS_MODEL` | `string` | `your_tts_model_here` | **yes** | TTS model identifier (default: `standard`) | Telnyx Voice TTS docs |
| `TTS_VOICE` | `string` | `your_tts_voice_here` | **yes** | TTS voice identifier (default: `en-US-Standard-A`) | Telnyx Voice TTS docs |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/tts-article-audio-publisher

# 2. Copy the environment template
cp .env.example .env

# 3. Edit .env with your Telnyx credentials and configuration
#    (See Environment Variables table above)

# 4. Install dependencies
pip install -r requirements.txt

# 5. Run the Flask server locally
python app.py

# 6. (Optional) Run the smoke test to verify the full pipeline
python smoke_test.py
```

**Running the cycle manually:**
```bash
# Trigger one processing cycle via the /run endpoint
curl -X POST http://localhost:8080/run
```

**Running on a schedule (Telnyx Functions):**
Deploy the app as a Telnyx Function with a cron trigger. The `/schedule` endpoint receives the cron event payload and executes `run_cycle()`.

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check endpoint. Returns `{"status": "ok", "service": "tts-article-audio-publisher"}`. |
| `POST` | `/run` | Manual trigger to execute one full detect → synthesize → publish → verify cycle. Returns a JSON summary with `total_articles`, `processed`, `skipped`, `failed`, and `details`. |
| `POST` | `/schedule` | Scheduled/cron trigger endpoint. Accepts a Telnyx Function cron event payload (JSON body). Executes `run_cycle()` and returns the same summary as `/run`. |
| `GET` | `/article/<article_id>/status` | Check the publication status of a specific article. Returns `published`, `content_hash`, and `cdn_url` if the article has been processed, or `published: false` if not. |

**Response shape for `/run` and `/schedule`:**
```json
{
  "total_articles": 3,
  "processed": 3,
  "skipped": 0,
  "failed": 0,
  "details": [
    {
      "article_id": "article-001",
      "status": "success",
      "cdn_url": "https://cdn.telnyx.com/bucket/tts-audio/article-001/abc123.mp3",
      "content_hash": "abc123..."
    }
  ]
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `RuntimeError: Missing required environment variables` | One or more env vars not set in `.env` | Copy `.env.example` to `.env` and fill in all required values |
| `TTS synthesis failed` | Invalid `TTS_VOICE` or `TTS_MODEL`, or API key lacks Voice permissions | Verify `TTS_VOICE` and `TTS_MODEL` in the Telnyx docs; check API key scopes |
| `Storage upload failed` | `STORAGE_BUCKET` does not exist or credentials lack write access | Create the bucket in the Telnyx Portal; verify API key has Storage write scope |
| `CDN URL verification failed` | CDN not configured for the bucket, or propagation delay | Ensure CDN is enabled on the Storage bucket; retry after a few seconds |
| `KV get/put failed` | `KV_NAMESPACE` is invalid or KV not provisioned | Create a KV namespace in the Telnyx Portal and set `KV_NAMESPACE` to its ID |
| `SQLDB connection error` | `SQLDB_CONNECTION_STRING` is malformed or database unreachable | Verify the connection string format; for local testing use `sqlite:///articles.db` |
| `psycopg2` not found | PostgreSQL driver not installed | Run `pip install psycopg2-binary` or use SQLite for local testing |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **Voice TTS Quickstart** — Basic single-article TTS synthesis using Telnyx Voice
- **Storage Object Upload** — Uploading and serving static files via Telnyx Storage CDN
- **KV Cache Pattern** — Using KV for content-addressable caching with versioned keys
- **SQLDB + Functions Integration** — Scheduled data processing with SQLDB as the source of truth

## Resources

- [Telnyx Voice TTS Documentation](https://docs.telnyx.com/voice/text-to-speech)
- [Telnyx Storage Documentation](https://docs.telnyx.com/storage)
- [Telnyx KV Documentation](https://docs.telnyx.com/kv)
- [Telnyx SQLDB Documentation](https://docs.telnyx.com/sqldb)
- [Telnyx Functions Documentation](https://docs.telnyx.com/functions)
- [Telnyx Python SDK Reference](https://docs.telnyx.com/sdk/python)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Storage Pricing](https://telnyx.com/pricing/storage)
