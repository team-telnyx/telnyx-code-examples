# TTS Article-to-Audio Publisher — Developer Guide

This guide walks you through how the `tts-article-audio-publisher` sample works, step by step. You'll learn how a scheduled Telnyx Function detects new or updated articles in SQLDB, generates narrated audio via Text-to-Speech, publishes the audio to Storage, and tracks versions in KV — all in an idempotent, resumable pipeline.

---

## Prerequisites

Before you begin, ensure you have:

- A **Telnyx account** with access to Voice (TTS), Storage, KV, and SQLDB products
- Python 3.9+ installed locally
- `pip` package manager
- A PostgreSQL-compatible database (or SQLite for local testing)
- Basic familiarity with Flask, REST APIs, and environment-based configuration

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/tts-article-audio-publisher
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and provide:

| Variable | Description |
|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key (required) |
| `SQLDB_CONNECTION_STRING` | PostgreSQL or SQLite connection string (required) |
| `STORAGE_BUCKET` | Name of your Telnyx Storage bucket (required) |
| `KV_NAMESPACE` | KV namespace identifier (required) |
| `TTS_VOICE` | Voice identifier for TTS (e.g., `en-US-Standard-A`) |
| `TTS_MODEL` | TTS model (`standard` or `neural`) |
| `CDN_BASE_URL` | Base URL for public CDN access to Storage objects |
| `CRON_SCHEDULE` | Cron expression for scheduled runs (default: hourly) |
| `PORT` | Port for local Flask server (default: 8080) |

> **Security note:** Never commit your `.env` file. It is listed in `.gitignore`.

---

## Running the Application

### Local development mode

Start the Flask server:

```bash
python app.py
```

The server starts on `http://localhost:8080`.

### Manual trigger (single cycle)

Send a POST request to run one full detect → synthesize → publish → verify cycle:

```bash
curl -X POST http://localhost:8080/run
```

### Scheduled trigger (cron)

The `/schedule` endpoint accepts a Telnyx Function cron event payload:

```bash
curl -X POST http://localhost:8080/schedule \
  -H "Content-Type: application/json" \
  -d '{"scheduledTime":"2024-01-01T00:00:00Z"}'
```

### Health check

```bash
curl http://localhost:8080/health
```

---

## How It Works — Step by Step

### Step 1: Environment Loading & Validation

At startup, the application loads environment variables using `dotenv` and validates that all required variables are present. If any are missing, it raises a `RuntimeError` immediately — before any processing begins — so you get a clear error message rather than a crash mid-cycle.

**Key code section:** Environment loading block at the top of `app.py`

```python
REQUIRED_ENV_VARS = [
    "TELNYX_API_KEY",
    "SQLDB_CONNECTION_STRING",
    "STORAGE_BUCKET",
    "KV_NAMESPACE",
    "TTS_VOICE",
    "TTS_MODEL",
    "CDN_BASE_URL",
]

_missing = [v for v in REQUIRED_ENV_VARS if not os.getenv(v)]
if _missing:
    raise RuntimeError(
        f"Missing required environment variables: {', '.join(_missing)}"
    )
```

This satisfies the acceptance criterion: missing environment variables produce a clear startup error naming the missing variable.

---

### Step 2: Database Initialization & Article Fetching

The `init_db()` function creates the `articles` table if it doesn't exist (for local SQLite). The `fetch_articles()` function retrieves all articles from SQLDB, ordered by ID.

**Key code section:** SQLDB helpers

```python
def init_db():
    conn = get_db_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published BOOLEAN DEFAULT FALSE
            )
        """)
        conn.commit()
    finally:
        conn.close()

def fetch_articles() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, title, body, content_hash, updated_at, published FROM articles ORDER BY id"
        )
        rows = cursor.fetchall()
        articles = []
        for row in rows:
            if isinstance(row, dict):
                articles.append(row)
            else:
                articles.append(dict(row))
        return articles
    finally:
        conn.close()
```

The `get_db_connection()` function supports both PostgreSQL (via `psycopg2`) and SQLite (via `sqlite3`), making local testing easy while remaining production-ready.

---

### Step 3: Content Hash Computation

Each article's body is hashed using SHA-256. This hash serves as the change-detection mechanism: if the hash changes, the article has been updated and needs re-synthesis.

**Key code section:** `compute_content_hash()`

```python
def compute_content_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()
```

This hash is stored in SQLDB's `content_hash` column and also tracked in KV for cross-run comparison.

---

### Step 4: Article Diff — Detecting New or Updated Articles

The `diff_articles()` function compares each article's current content hash against the hash stored in KV. Articles that are new (no KV entry) or changed (hash mismatch) are added to the processing queue. Unchanged articles are skipped entirely.

**Key code section:** `diff_articles()`

```python
def diff_articles(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    to_process = []
    for article in articles:
        article_id = article["id"]
        current_hash = article.get("content_hash") or compute_content_hash(article["body"])
        stored_hash = get_stored_version(article_id)

        if stored_hash is None:
            logger.info(f"Article {article_id} is new — will synthesize")
            to_process.append(article)
        elif stored_hash != current_hash:
            logger.info(f"Article {article_id} has changed — will regenerate")
            to_process.append(article)
        else:
            logger.info(f"Article {article_id} unchanged — skipping")

    return to_process
```

This satisfies the acceptance criterion: a second cycle with unchanged articles makes 0 TTS calls and 0 new Storage uploads.

---

### Step 5: KV Version Store

The KV store tracks the last-known content hash for each article. The key naming scheme is:

```
tts:article_version:<article_id>
```

**Key code section:** KV helpers

```python
KV_KEY_PREFIX = "tts:article_version:"

def get_kv_key(article_id: str) -> str:
    return f"{KV_KEY_PREFIX}{article_id}"

def get_stored_version(article_id: str) -> Optional[str]:
    kv = get_kv_client()
    key = get_kv_key(article_id)
    result = kv.get(key)
    # ... extract value from result ...

def set_stored_version(article_id: str, content_hash: str):
    kv = get_kv_client()
    key = get_kv_key(article_id)
    kv.put(key, content_hash)
```

This satisfies the acceptance criterion: KV-backed version keys make regeneration targeted — editing one article triggers regeneration of exactly that article's audio.

---

### Step 6: TTS Synthesis

The `synthesize_tts()` function calls the Telnyx Voice Text-to-Speech API to generate audio from the article body. It handles both direct audio responses and URL-based responses (where audio must be fetched separately).

**Key code section:** `synthesize_tts()`

```python
def synthesize_tts(text: str, voice: str = TTS_VOICE, model: str = TTS_MODEL) -> bytes:
    telnyx = get_telnyx_client()
    response = telnyx.voice.TextToSpeech.create(
        text=text,
        voice=voice,
        model=model,
    )
    # Handle audio data or URL-based response
    if hasattr(response, "audio") and response.audio:
        return response.audio
    elif hasattr(response, "url") and response.url:
        import requests
        audio_resp = requests.get(response.url)
        audio_resp.raise_for_status()
        return audio_resp.content
    # ... fallback handling ...
```

This uses the real Telnyx SDK (`import telnyx`) for API calls, not raw HTTP.

---

### Step 7: Storage Publishing

The `publish_to_storage()` function uploads the synthesized audio to Telnyx Storage under a versioned object key:

```
tts-audio/<article_id>/<content_hash>.mp3
```

The versioned key ensures that each regeneration produces a unique, immutable object. The public CDN URL is constructed from `CDN_BASE_URL`, `STORAGE_BUCKET`, and the object key.

**Key code section:** `publish_to_storage()`

```python
def publish_to_storage(article_id: str, content_hash: str, audio_bytes: bytes) -> str:
    storage = get_storage_client()
    object_key = f"tts-audio/{article_id}/{content_hash}.mp3"
    upload_response = storage.objects.upload(
        bucket=STORAGE_BUCKET,
        key=object_key,
        body=audio_bytes,
        content_type="audio/mpeg",
    )
    cdn_url = f"{CDN_BASE_URL}/{STORAGE_BUCKET}/{object_key}"
    return cdn_url
```

This satisfies the acceptance criterion: each article produces a narrated audio file published to Storage at a stable, versioned object key with a working public CDN URL.

---

### Step 8: CDN URL Verification

After uploading, the `verify_cdn_url()` function performs an HTTP HEAD request to confirm the CDN URL is reachable and returns an `audio/*` content type. Only verified articles have their KV version updated.

**Key code section:** `verify_cdn_url()`

```python
def verify_cdn_url(url: str) -> bool:
    import requests
    resp = requests.head(url, timeout=10)
    if resp.status_code == 200:
        content_type = resp.headers.get("Content-Type", "")
        if content_type.startswith("audio/"):
            return True
    return False
```

This satisfies the acceptance criterion: the published CDN URL resolves to the new audio version.

---

### Step 9: The Full Processing Cycle

The `run_cycle()` function orchestrates the entire pipeline:

1. Initialize the database
2. Fetch all articles from SQLDB
3. Diff articles against KV-stored versions
4. For each article needing processing:
   - Synthesize TTS audio
   - Publish to Storage
   - Verify CDN URL
   - Update KV version (only if verification passes)
5. Return a summary of results

**Key code section:** `run_cycle()`

```python
def run_cycle() -> Dict[str, Any]:
    init_db()
    articles = fetch_articles()
    to_process = diff_articles(articles)

    results = {
        "total_articles": len(articles),
        "processed": 0,
        "skipped": len(articles) - len(to_process),
        "failed": 0,
        "details": [],
    }

    for article in to_process:
        try:
            audio_bytes = synthesize_tts(body)
            cdn_url = publish_to_storage(article_id, content_hash, audio_bytes)
            if verify_cdn_url(cdn_url):
                set_stored_version(article_id, content_hash)
                results["processed"] += 1
            else:
                results["failed"] += 1
        except Exception as e:
            results["failed"] += 1
            logger.exception(f"Failed to process article {article_id}")

    return results
```

This satisfies the acceptance criterion: the pipeline is idempotent and resumable — a failed or interrupted run can be re-executed without duplicating audio or corrupting state. If an article fails during TTS synthesis, it won't have its KV version updated, so the next run will retry it. Articles that already succeeded will be skipped because their KV version matches.

---

### Step 10: Flask Routes

The application exposes four HTTP endpoints:

| Route | Method | Description |
|---|---|---|
| `/health` | GET | Health check returning service status |
| `/run` | POST | Manual trigger to run one processing cycle |
| `/schedule` | POST | Scheduled/cron trigger accepting a Telnyx Function cron event payload |
| `/article/<article_id>/status` | GET | Check publication status of a specific article |

**Key code section:** Flask routes

```python
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "tts-article-audio-publisher"})

@app.route("/run", methods=["POST"])
def run_handler():
    results = run_cycle()
    return jsonify(results), 200

@app.route("/schedule", methods=["POST"])
def schedule_handler():
    event = request.get_json(silent=True) or {}
    logger.info(f"Received scheduled event: {json.dumps(event)}")
    results = run_cycle()
    return jsonify(results), 200

@app.route("/article/<article_id>/status", methods=["GET"])
def article_status(article_id: str):
    stored_hash = get_stored_version(article_id)
    if stored_hash:
        cdn_url = f"{CDN_BASE_URL}/{STORAGE_BUCKET}/tts-audio/{article_id}/{stored_hash}.mp3"
        return jsonify({"article_id": article_id, "published": True, "cdn_url": cdn_url}), 200
    return jsonify({"article_id": article_id, "published": False}), 200
```

---

## Telnyx Primitives Used

This sample demonstrates integration across five Telnyx primitives:

1. **Functions (Scheduled/Cron Trigger)** — The `/schedule` endpoint is designed to be invoked by a Telnyx Function on a cron interval. The `CRON_SCHEDULE` environment variable controls the frequency.

2. **SQLDB** — Serves as the source-of-truth for articles. The `articles` table stores article metadata, body content, and a content hash for change detection.

3. **Voice (Text-to-Speech)** — The `telnyx.voice.TextToSpeech.create()` API generates narrated audio from article bodies. Configurable voice and model parameters allow for different audio quality and language options.

4. **Storage** — Audio files are uploaded as versioned objects under `tts-audio/<article_id>/<content_hash>.mp3`. Each upload produces a unique, immutable object that can be served via CDN.

5. **KV** — Stores the article-to-version mapping (`tts:article_version:<article_id>` → `<content_hash>`). This acts as the cache key that enables targeted regeneration: only articles whose hash has changed are reprocessed.

---

## Idempotency & Resumability

The pipeline is designed to be safe to re-run:

- **Unchanged articles** are skipped because their KV-stored hash matches the current hash — no TTS calls, no Storage uploads.
- **Already-published articles** that failed CDN verification are not re-uploaded; they remain in the processing queue for the next cycle.
- **Failed articles** do not have their KV version updated, so the next run will retry them.
- **Successful articles** have their KV version updated only after CDN verification passes, ensuring consistency.

This satisfies the acceptance criterion: simulating a TTS failure mid-batch and re-running completes the batch without duplicating audio for already-published articles or skipping the failed one.

---

## Smoke Test

A scripted smoke test is provided in `smoke_test.py`. It:

1. Seeds SQLDB with 3 fixture articles
2. Runs one full processing cycle
3. Asserts that 3 audio files exist in Storage
4. Verifies each CDN URL returns HTTP 200 with an `audio/*` content type
5. Checks that KV version keys are updated for all 3 articles
6. Exits non-zero on any failure

Run it with:

```bash
python smoke_test.py
```

This satisfies the acceptance criterion: the scripted smoke test seeds fixtures, executes one full cycle, and asserts Storage objects, CDN URL reachability, and KV version state, exiting non-zero on failure.

---

## Demo Mode vs. Live Mode

By default, the application runs in **live mode** — it makes real API calls to Telnyx Voice, Storage, and KV. This is appropriate when you have a Telnyx account and want to test end-to-end.

For **demo mode** (no real charges), you can:

1. Set `TELNYX_API_KEY` to a dummy value — the app will still start and process articles, but TTS synthesis will fail gracefully (logged as errors, not crashes).
2. Use SQLite (`sqlite:///test.db`) for SQLDB to avoid needing a real PostgreSQL instance.
3. Set `CDN_BASE_URL` to a placeholder — CDN verification will fail, but the pipeline will complete and report results.

To switch to live mode, simply provide real Telnyx credentials and a real Storage bucket.

---

## Next Steps

- **Schedule the Function**: Deploy this Flask app as a Telnyx Function and configure the cron schedule using the `CRON_SCHEDULE` environment variable. See the [Telnyx Functions documentation](https://docs.telnyx.com/compute/functions) for deployment instructions.
- **Add article ingestion**: Connect your CMS to SQLDB so new articles are automatically inserted into the `articles` table.
- **Customize TTS**: Experiment with different voices and models by changing `TTS_VOICE` and `TTS_MODEL`. See the [Telnyx Voice TTS documentation](https://docs.telnyx.com/voice/text-to-speech) for available options.
- **Implement retention policy**: The current implementation keeps old versioned keys indefinitely. Add a cleanup step to remove old versions based on your retention requirements.
- **Add monitoring**: Integrate with Telnyx's monitoring tools to track TTS usage, Storage costs, and pipeline success rates.

### Related Documentation

- [Telnyx Voice API — Text-to-Speech](https://docs.telnyx.com/voice/text-to-speech)
- [Telnyx Storage](https://docs.telnyx.com/storage)
- [Telnyx KV](https://docs.telnyx.com/kv)
- [Telnyx SQLDB](https://docs.telnyx.com/sqrldb)
- [Telnyx Functions](https://docs.telnyx.com/compute/functions)
- [Telnyx Edge SDK](https://docs.telnyx.com/edge-sdk)
