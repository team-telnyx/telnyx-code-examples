"""
Smoke test: verifies the app module loads and core functions work.
Run with: python -m pytest smoke_test.py -v
"""

import importlib
import os
import sys

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


def test_telnyx_client_exists():
    """Verify Telnyx SDK v4 client is constructed."""
    import app
    assert hasattr(app, "telnyx_client")
    assert app.telnyx_client is not None


def test_routes_registered():
    """Verify expected routes are registered."""
    import app
    rules = {rule.rule for rule in app.app.url_map.iter_rules()}
    assert "/webhooks/call-quality" in rules
    assert "/" in rules
    assert "/events" in rules
    assert "/api/quality" in rules
    assert "/api/quality/<call_id>" in rules
    assert "/api/quality/stats" in rules
    assert "/api/quality/alerts" in rules
    assert "/health" in rules


def test_kv_helpers():
    """Verify in-memory KV store works."""
    import app
    app.call_state["test-call"] = {"metrics": [], "alerts": []}
    assert "test-call" in app.call_state
    del app.call_state["test-call"]
    assert "test-call" not in app.call_state


def test_db_init():
    """Verify database initialization works."""
    import app
    app.init_db()
    import os
    assert os.path.exists(app.DB_PATH) or app.DB_PATH == "call_quality.db"


def test_thresholds_loaded():
    """Verify threshold configuration is loaded."""
    import app
    assert hasattr(app, "MOS_THRESHOLD")
    assert hasattr(app, "JITTER_THRESHOLD")
    assert hasattr(app, "LATENCY_THRESHOLD")


def test_check_thresholds():
    """Verify threshold checking logic."""
    import app
    # Low MOS should trigger
    alerts = app.check_thresholds({"mos": 2.0, "jitter": 10, "latency": 50})
    assert len(alerts) == 1
    assert "MOS" in alerts[0]

    # High jitter should trigger
    alerts = app.check_thresholds({"mos": 4.5, "jitter": 100, "latency": 50})
    assert len(alerts) == 1
    assert "Jitter" in alerts[0]

    # High latency should trigger
    alerts = app.check_thresholds({"mos": 4.5, "jitter": 10, "latency": 300})
    assert len(alerts) == 1
    assert "Latency" in alerts[0]

    # All good — no alerts
    alerts = app.check_thresholds({"mos": 4.5, "jitter": 10, "latency": 50})
    assert len(alerts) == 0


def test_store_and_retrieve_metric():
    """Verify a metric can be stored and retrieved from SQLite."""
    import app
    app.init_db()
    metric = {
        "call_id": "test-call-123",
        "timestamp": "2025-01-15T12:00:00+00:00",
        "mos": 4.2,
        "jitter": 15.0,
        "latency": 80.0,
        "packet_loss": 0.1,
        "source": "test",
        "raw": {"call_leg_id": "test-call-123"},
        "from_number": "+15551234567",
        "to_number": "+15557654321",
    }
    app.store_metric(metric)

    conn = __import__("sqlite3").connect(app.DB_PATH)
    conn.row_factory = __import__("sqlite3").Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM call_quality_metrics WHERE call_id = ?", ("test-call-123",))
    row = cur.fetchone()
    conn.close()
    assert row is not None
    assert row["call_id"] == "test-call-123"
    assert row["mos"] == 4.2
