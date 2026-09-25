"""
Smoke test: verifies the app module loads and core functions work.
Run with: python -m pytest smoke_test.py -v
"""

import importlib
import os
import sqlite3
import sys

# Ensure the app directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set dummy env vars so the app can import without real credentials
os.environ.setdefault("TELNYX_API_KEY", "test_dummy_key")
os.environ.setdefault("TELNYX_FROM_NUMBER", "+15555550100")
os.environ.setdefault("TELNYX_EMAIL_FROM", "test@example.com")
os.environ.setdefault("CONNECTION_ID", "test_connection")
os.environ.setdefault("DB_PATH", "test_conversations.db")


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


def test_routes_registered():
    """Verify expected routes are registered."""
    import app
    rules = {rule.rule for rule in app.app.url_map.iter_rules()}
    assert "/webhooks/voice" in rules
    assert "/webhooks/messaging" in rules
    assert "/webhooks/email" in rules
    assert "/agent/run" in rules
    assert "/conversations" in rules
    assert "/health" in rules


def test_db_init():
    """Verify database initialization creates the conversations table."""
    import app
    app.init_db()
    conn = sqlite3.connect(app.DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
    assert cur.fetchone() is not None
    conn.close()


def test_store_and_retrieve_message():
    """Verify messages can be stored and retrieved from SQLite."""
    import app
    app.init_db()
    app.store_message("test-customer", "email", "assistant", "Test email sent")
    history = app.get_conversation_history("test-customer")
    assert len(history) >= 1
    assert history[-1]["channel"] == "email"
    assert history[-1]["content"] == "Test email sent"


def test_conversation_history_ordering():
    """Verify conversation history returns messages in chronological order."""
    import app
    app.init_db()
    app.store_message("test-order", "email", "assistant", "First")
    app.store_message("test-order", "sms", "assistant", "Second")
    app.store_message("test-order", "voice", "assistant", "Third")
    history = app.get_conversation_history("test-order")
    assert len(history) >= 3
    contents = [h["content"] for h in history[-3:]]
    assert contents == ["First", "Second", "Third"]


def test_tools_defined():
    """Verify all four tools are defined."""
    import app
    tool_names = {t["function"]["name"] for t in app.TOOLS}
    assert tool_names == {"send_email", "send_sms", "make_call", "resolve_issue"}


def test_tool_schemas_valid():
    """Verify each tool has a valid schema with required fields."""
    import app
    for tool in app.TOOLS:
        assert tool["type"] == "function"
        fn = tool["function"]
        assert "name" in fn
        assert "description" in fn
        assert "parameters" in fn
        schema = fn["parameters"]
        assert schema["type"] == "object"
        assert "properties" in schema
        assert "required" in schema
        assert len(schema["required"]) > 0


def test_health_endpoint():
    """Verify health endpoint returns 200."""
    import app
    with app.app.test_client() as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"


def test_conversations_endpoint():
    """Verify conversations endpoint returns 200."""
    import app
    app.init_db()
    with app.app.test_client() as client:
        resp = client.get("/conversations")
        assert resp.status_code == 200


def test_agent_run_requires_body():
    """Verify /agent/run rejects requests without required fields."""
    import app
    with app.app.test_client() as client:
        resp = client.post("/agent/run", json={})
        assert resp.status_code == 400


# Cleanup test DB after all tests
def teardown_module():
    db_path = os.environ.get("DB_PATH", "test_conversations.db")
    if os.path.exists(db_path):
        os.remove(db_path)
