```python
"""
Smoke test for TTS Article-to-Audio Publisher.
Verifies that the main module loads without error and basic functions are callable.
"""

import os
import sys
import importlib

# Ensure src is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_module_imports():
    """Test that app.py imports without error."""
    import app
    assert app is not None


def test_flask_app_exists():
    """Test that Flask app is created."""
    import app
    assert app.app is not None
    assert app.app.name == "app"


def test_health_endpoint():
    """Test the /health endpoint returns 200."""
    import app
    client = app.app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert data["service"] == "tts-article-audio-publisher"


def test_article_status_endpoint():
    """Test the /article/<id>/status endpoint returns 200."""
    import app
    client = app.app.test_client()
    response = client.get("/article/test-article-1/status")
    assert response.status_code == 200


def test_compute_content_hash():
    """Test content hash computation is deterministic."""
    import app
    h1 = app.compute_content_hash("hello world")
    h2 = app.compute_content_hash("hello world")
    h3 = app.compute_content_hash("hello world!")
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 64  # SHA-256 hex digest


def test_kv_key_naming():
    """Test KV key naming scheme."""
    import app
    key = app.get_kv_key("article-123")
    assert key == "tts:article_version:article-123"


def test_diff_articles_empty():
    """Test diff with empty article list returns empty."""
    import app
    result = app.diff_articles([])
    assert result == []


def test_run_handler_returns_json():
    """Test the /run endpoint returns JSON response."""
    import app
    client = app.app.test_client()
    response = client.post("/run")
    assert response.status_code == 200
    data = response.get_json()
    assert "total_articles" in data
    assert "processed" in data
    assert "skipped" in data
    assert "failed" in data


def test_schedule_handler():
    """Test the /schedule endpoint accepts cron event payload."""
    import app
    client = app.app.test_client()
    response = client.post("/schedule", json={"event": "cron", "timestamp": "2024-01-01T00:00:00Z"})
    assert response.status_code == 200
    data = response.get_json()
    assert "total_articles" in data


if __name__ == "__main__":
    # Run tests manually
    test_module_imports()
    print("✓ Module imports successfully")

    test_flask_app_exists()
    print("✓ Flask app exists")

    test_health_endpoint()
    print("✓ /health endpoint works")

    test_article_status_endpoint()
    print("✓ /article/<id>/status endpoint works")

    test_compute_content_hash()
    print("✓ Content hash computation works")

    test_kv_key_naming()
    print("✓ KV key naming scheme correct")

    test_diff_articles_empty()
    print("✓ Article diff with empty list works")

    test_run_handler_returns_json()
    print("✓ /run endpoint works")

    test_schedule_handler()
    print("✓ /schedule endpoint works")

    print("\n✅ All smoke tests passed!")
```
