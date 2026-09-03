```python
"""
TTS Article-to-Audio Publisher
A scheduled Telnyx Function that detects new/updated articles in SQLDB,
generates narrated audio via Text-to-Speech, publishes to Storage,
and tracks versions in KV.
"""

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, request

# ---------------------------------------------------------------------------
# Environment loading & validation
# ---------------------------------------------------------------------------

load_dotenv()

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

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
SQLDB_CONNECTION_STRING = os.getenv("SQLDB_CONNECTION_STRING")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")
KV_NAMESPACE = os.getenv("KV_NAMESPACE")
TTS_VOICE = os.getenv("TTS_VOICE", "en-US-Standard-A")
TTS_MODEL = os.getenv("TTS_MODEL", "standard")
CDN_BASE_URL = os.getenv("CDN_BASE_URL")
CRON_SCHEDULE = os.getenv("CRON_SCHEDULE", "0 * * * *")  # hourly default

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Telnyx SDK clients (lazy-initialized)
# ---------------------------------------------------------------------------

_telnyx_client = None
_storage_client = None
_kv_client = None


def get_telnyx_client():
    global _telnyx_client
    if _telnyx_client is None:
        import telnyx
        _telnyx_client = telnyx
    return _telnyx_client


def get_storage_client():
    global _storage_client
    if _storage_client is None:
        from telnyx import storage
        _storage_client = storage
    return _storage_client


def get_kv_client():
    global _kv_client
    if _kv_client is None:
        from telnyx import kv
        _kv_client = kv
    return _kv_client


# ---------------------------------------------------------------------------
# SQLDB helpers (using psycopg2 for PostgreSQL; fallback to sqlite3)
# ---------------------------------------------------------------------------

def get_db_connection():
    """Return a DB connection. Uses psycopg2 for PostgreSQL connection strings."""
    if SQLDB_CONNECTION_STRING.startswith("sqlite://"):
        import sqlite3
        path = SQLDB_CONNECTION_STRING.replace("sqlite://", "")
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    else:
        import psycopg2
        conn = psycopg2.connect(SQLDB_CONNECTION_STRING)
        return conn


def init_db():
    """Create the articles table if it doesn't exist (for local SQLite)."""
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
    """Fetch all articles from SQLDB."""
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


def compute_content_hash(body: str) -> str:
    """Compute SHA-256 hash of article body for change detection."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# KV version store
# ---------------------------------------------------------------------------

KV_KEY_PREFIX = "tts:article_version:"


def get_kv_key(article_id: str) -> str:
    return f"{KV_KEY_PREFIX}{article_id}"


def get_stored_version(article_id: str) -> Optional[str]:
    """Retrieve the stored content hash for an article from KV."""
    try:
        kv = get_kv_client()
        key = get_kv_key(article_id)
        result = kv.get(key)
        if result and hasattr(result, "value"):
            return result.value
        elif result and isinstance(result, dict):
            return result.get("value")
        elif result and isinstance(result, str):
            return result
        return None
    except Exception as e:
        logger.warning(f"KV get failed for article {article_id}: {e}")
        return None


def set_stored_version(article_id: str, content_hash: str):
    """Store the content hash for an article in KV."""
    try:
        kv = get_kv_client()
        key = get_kv_key(article_id)
        kv.put(key, content_hash)
        logger.info(f"KV updated: {key} = {content_hash}")
    except Exception as e:
        logger.error(f"KV put failed for article {article_id}: {e}")
        raise


# ---------------------------------------------------------------------------
# TTS synthesis
# ---------------------------------------------------------------------------

def synthesize_tts(text: str, voice: str = TTS_VOICE, model: str = TTS_MODEL) -> bytes:
    """
    Synthesize speech from text using Telnyx Voice TTS.
    Returns raw audio bytes (WAV/MP3).
    """
    telnyx = get_telnyx_client()
    try:
        response = telnyx.voice.TextToSpeech.create(
            text=text,
            voice=voice,
            model=model,
        )
        # The response may contain audio data directly or a URL to fetch
        if hasattr(response, "audio") and response.audio:
            return response.audio
        elif hasattr(response, "url") and response.url:
            import requests
            audio_resp = requests.get(response.url)
            audio_resp.raise_for_status()
            return audio_resp.content
        elif isinstance(response, dict):
            if "audio" in response:
                return response["audio"]
            elif "url" in response:
                import requests
                audio_resp = requests.get(response["url"])
                audio_resp.raise_for_status()
                return audio_resp.content
        # Fallback: response body as bytes
        return response.content if hasattr(response, "content") else b""
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}")
        raise


# ---------------------------------------------------------------------------
# Storage publisher
# ---------------------------------------------------------------------------

def publish_to_storage(article_id: str, content_hash: str, audio_bytes: bytes) -> str:
    """
    Upload audio bytes to Telnyx Storage under a versioned object key.
    Returns the public CDN URL.
    """
    storage = get_storage_client()
    object_key = f"tts-audio/{article_id}/{content_hash}.mp3"
    try:
        # Upload to storage
        upload_response = storage.objects.upload(
            bucket=STORAGE_BUCKET,
            key=object_key,
            body=audio_bytes,
            content_type="audio/mpeg",
        )
        logger.info(f"Storage uploaded: {object_key}")

        # Construct CDN URL
        cdn_url = f"{CDN_BASE_URL}/{STORAGE_BUCKET}/{object_key}"
        return cdn_url
    except Exception as e:
        logger.error(f"Storage upload failed for {object_key}: {e}")
        raise


def verify_cdn_url(url: str) -> bool:
    """Verify that a CDN URL is reachable and returns audio content."""
    try:
        import requests
        resp = requests.head(url, timeout=10)
        if resp.status_code == 200:
            content_type = resp.headers.get("Content-Type", "")
            if content_type.startswith("audio/"):
                return True
            logger.warning(f"CDN URL {url} returned non-audio content type: {content_type}")
            return False
        logger.warning(f"CDN URL {url} returned status {resp.status_code}")
        return False
    except Exception as e:
        logger.error(f"CDN URL verification failed for {url}: {e}")
        return False


# ---------------------------------------------------------------------------
# Article diff module
# ---------------------------------------------------------------------------

def diff_articles(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Compare articles against KV-stored versions.
    Returns list of articles that are new or have changed content.
    """
    to_process = []
    for article in articles:
        article_id = article["id"]
        current_hash = article.get("content_hash") or compute_content_hash(article["body"])
        stored_hash = get_stored_version(article_id)

        if stored_hash is None:
            logger.info(f"Article {article_id} is new — will synthesize")
            to_process.append(article)
        elif stored_hash != current_hash:
            logger.info(f"Article {article_id} has changed (hash: {stored_hash} -> {current_hash}) — will regenerate")
            to_process.append(article)
        else:
            logger.info(f"Article {article_id} unchanged — skipping")

    return to_process


# ---------------------------------------------------------------------------
# Main processing cycle
# ---------------------------------------------------------------------------

def run_cycle() -> Dict[str, Any]:
    """
    Execute one full detect → synthesize → publish → verify cycle.
    Returns a summary dict.
    """
    init_db()
    articles = fetch_articles()
    logger.info(f"Fetched {len(articles)} articles from SQLDB")

    to_process = diff_articles(articles)
    logger.info(f"{len(to_process)} articles need processing")

    results = {
        "total_articles": len(articles),
        "processed": 0,
        "skipped": len(articles) - len(to_process),
        "failed": 0,
        "details": [],
    }

    for article in to_process:
        article_id = article["id"]
        title = article.get("title", "")
        body = article.get("body", "")
        content_hash = article.get("content_hash") or compute_content_hash(body)

        try:
            # Step 1: Synthesize TTS
            logger.info(f"Synthesizing TTS for article {article_id}: '{title}'")
            audio_bytes = synthesize_tts(body)

            # Step 2: Publish to Storage
            cdn_url = publish_to_storage(article_id, content_hash, audio_bytes)

            # Step 3: Verify CDN URL
            if verify_cdn_url(cdn_url):
                # Step 4: Update KV version
                set_stored_version(article_id, content_hash)
                results["processed"] += 1
                results["details"].append({
                    "article_id": article_id,
                    "status": "success",
                    "cdn_url": cdn_url,
                    "content_hash": content_hash,
                })
                logger.info(f"Article {article_id} published successfully: {cdn_url}")
            else:
                results["failed"] += 1
                results["details"].append({
                    "article_id": article_id,
                    "status": "cdn_verification_failed",
                    "cdn_url": cdn_url,
                })
                logger.error(f"CDN verification failed for article {article_id}")

        except Exception as e:
            results["failed"] += 1
            results["details"].append({
                "article_id": article_id,
                "status": "error",
                "error": str(e),
            })
            logger.exception(f"Failed to process article {article_id}")

    logger.info(f"Cycle complete: {results['processed']} processed, {results['failed']} failed, {results['skipped']} skipped")
    return results


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "tts-article-audio-publisher"})


@app.route("/run", methods=["POST"])
def run_handler():
    """Manual trigger endpoint to run one processing cycle."""
    try:
        results = run_cycle()
        return jsonify(results), 200
    except Exception as e:
        logger.exception("Cycle execution failed")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/schedule", methods=["POST"])
def schedule_handler():
    """
    Scheduled/cron trigger endpoint.
    Expects a Telnyx Function cron event payload.
    """
    try:
        event = request.get_json(silent=True) or {}
        logger.info(f"Received scheduled event: {json.dumps(event)}")

        results = run_cycle()
        return jsonify(results), 200
    except Exception as e:
        logger.exception("Scheduled cycle execution failed")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/article/<article_id>/status", methods=["GET"])
def article_status(article_id: str):
    """Check the publication status of a specific article."""
    try:
        stored_hash = get_stored_version(article_id)
        if stored_hash:
            cdn_url = f"{CDN_BASE_URL}/{STORAGE_BUCKET}/tts-audio/{article_id}/{stored_hash}.mp3"
            return jsonify({
                "article_id": article_id,
                "published": True,
                "content_hash": stored_hash,
                "cdn_url": cdn_url,
            }), 200
        else:
            return jsonify({
                "article_id": article_id,
                "published": False,
            }), 200
    except Exception as e:
        logger.exception(f"Status check failed for article {article_id}")
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
```
