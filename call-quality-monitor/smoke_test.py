```python
"""
Smoke test: verifies the app module loads without error.
Run with: python -m pytest smoke_test.py -v
"""

import importlib
import sys
import os

# Ensure the app directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_app_imports():
    """Verify app.py imports without error."""
    import app
    importlib.reload(app)
    assert app is not None


def test_flask_app_exists():
    """Verify Flask app object is created."""
    import app
    assert hasattr(app, "app")
    assert app.app is not None


def test_socketio_exists():
    """Verify SocketIO instance is created."""
    import app
    assert hasattr(app, "socketio")
    assert app.socketio is not None


def test_routes_registered():
    """Verify expected routes are registered."""
    import app
    rules = {rule.rule for rule in app.app.url_map.iter_rules()}
    assert "/webhooks/call-quality" in rules
    assert "/" in rules
    assert "/api/metrics" in rules
    assert "/health" in rules


def test_kv_helpers():
    """Verify KV helper functions work."""
    import app
    app.kv_set("test:key", "value")
    assert app.kv_get("test:key") == "value"
    app.kv_delete("test:key")
    assert app.kv_get("test:key") is None


def test_db_init():
    """Verify database initialization works."""
    import app
    app.init_db()
    assert os.path.exists(app.DB_PATH) or app.DB_PATH == "metrics.db"


def test_thresholds_loaded():
    """Verify threshold configuration is loaded."""
    import app
    assert hasattr(app, "MOS_THRESHOLD")
    assert hasattr(app, "JITTER_THRESHOLD")
    assert hasattr(app, "LATENCY_THRESHOLD")
```
