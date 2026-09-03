```python
"""
Smoke test for edge-llm-semantic-cache Flask app.
Verifies the module loads without error and basic structure is correct.
Run with: python -m pytest smoke_test.py -v
"""

import os
import sys
import importlib

def test_app_imports():
    """Verify the app module can be imported without error."""
    # Ensure we can import the main module
    import app as app_module
    assert hasattr(app_module, 'app'), "app module must expose a Flask 'app' object"
    assert hasattr(app_module, 'cosine_similarity'), "app module must expose cosine_similarity function"
    assert hasattr(app_module, 'get_embedding'), "app module must expose get_embedding function"
    assert hasattr(app_module, 'get_chat_completion'), "app module must expose get_chat_completion function"
    assert hasattr(app_module, 'search_cache'), "app module must expose search_cache function"
    assert hasattr(app_module, 'upsert_cache'), "app module must expose upsert_cache function"
    assert hasattr(app_module, 'load_index'), "app module must expose load_index function"
    assert hasattr(app_module, 'save_index'), "app module must expose save_index function"

def test_flask_routes_exist():
    """Verify the Flask app has the expected routes registered."""
    import app as app_module
    rules = {rule.rule: rule.methods for rule in app_module.app.url_map.iter_rules()}
    assert "/chat" in rules, "POST /chat route must be registered"
    assert "/health" in rules, "GET /health route must be registered"
    assert "POST" in rules["/chat"], "/chat must accept POST"
    assert "GET" in rules["/health"], "/health must accept GET"

def test_cosine_similarity_basic():
    """Verify cosine_similarity returns expected values for known vectors."""
    import app as app_module
    # Identical vectors should have similarity 1.0
    vec = [1.0, 2.0, 3.0]
    assert app_module.cosine_similarity(vec, vec) == 1.0
    # Orthogonal vectors should have similarity 0.0
    assert app_module.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0
    # Opposite vectors should have similarity -1.0
    assert app_module.cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == -1.0

def test_cosine_similarity_dimension_mismatch():
    """Verify cosine_similarity raises on dimension mismatch."""
    import app as app_module
    try:
        app_module.cosine_similarity([1.0, 2.0], [1.0, 2.0, 3.0])
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

def test_validate_env_missing_key():
    """Verify _validate_env returns an error when TELNYX_API_KEY is missing."""
    import app as app_module
    # Temporarily clear the env var
    original = os.environ.pop("TELNYX_API_KEY", None)
    try:
        # Reload module to pick up missing env
        importlib.reload(app_module)
        error = app_module._validate_env()
        assert error is not None, "Should return error message when TELNYX_API_KEY is missing"
        assert "TELNYX_API_KEY" in error
    finally:
        if original:
            os.environ["TELNYX_API_KEY"] = original
        importlib.reload(app_module)

def test_config_defaults():
    """Verify default configuration values are set."""
    import app as app_module
    assert app_module.SIMILARITY_THRESHOLD == 0.85
    assert app_module.CACHE_TTL_SECONDS == 300
    assert app_module.KV_INDEX_KEY == "semantic_cache_index"

def test_app_is_flask():
    """Verify the app object is a Flask instance."""
    import app as app_module
    from flask import Flask
    assert isinstance(app_module.app, Flask), "app must be a Flask instance"
```
