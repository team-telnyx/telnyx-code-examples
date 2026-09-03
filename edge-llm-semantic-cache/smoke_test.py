"""
Smoke test for the edge-llm-semantic-cache sample.

Verifies that the Flask app loads without error and basic endpoints respond.
"""
import os
import sys

# Ensure the app module can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as app_module


def test_app_imports():
    """Verify the app module imports successfully."""
    assert app_module is not None
    assert hasattr(app_module, "app")


def test_health_endpoint():
    """Verify the /health endpoint returns a 200 response."""
    client = app_module.app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"


def test_semantic_cache_miss():
    """Verify the /semantic-cache endpoint handles a cache miss."""
    client = app_module.app.test_client()
    response = client.post("/semantic-cache", json={"prompt": "Hello world"})
    assert response.status_code == 200
    data = response.get_json()
    assert "response" in data
    assert data["cached"] is False


def test_semantic_cache_hit():
    """Verify the /semantic-cache endpoint returns a cached response on second call."""
    client = app_module.app.test_client()
    # First call — cache miss
    response1 = client.post("/semantic-cache", json={"prompt": "Test prompt"})
    assert response1.status_code == 200
    data1 = response1.get_json()
    assert data1["cached"] is False

    # Second call — should be a cache hit
    response2 = client.post("/semantic-cache", json={"prompt": "Test prompt"})
    assert response2.status_code == 200
    data2 = response2.get_json()
    assert data2["cached"] is True
    assert data2["response"] == data1["response"]


def test_semantic_cache_missing_prompt():
    """Verify the /semantic-cache endpoint returns 400 when prompt is missing."""
    client = app_module.app.test_client()
    response = client.post("/semantic-cache", json={})
    assert response.status_code == 400
    data = response.get_json()
    assert "error" in data


def test_webhook_missing_signature():
    """Verify the /webhook endpoint returns 400 when signature headers are missing."""
    client = app_module.app.test_client()
    response = client.post("/webhook", json={"type": "test"})
    assert response.status_code == 400
    data = response.get_json()
    assert "error" in data
</arg_value></tool_call>
