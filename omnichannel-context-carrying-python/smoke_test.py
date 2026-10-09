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
    assert "/customers/register" in rules
    assert "/customers" in rules
    assert "/conversations" in rules
    assert "/health" in rules


def test_db_init():
    """Verify database initialization creates both tables."""
    import app
    app.init_db()
    conn = sqlite3.connect(app.DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
    assert cur.fetchone() is not None
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'")
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


def test_customer_registration():
    """Verify customer registration and lookup."""
    import app
    app.init_db()
    customer = app.register_customer(
        "test_cust_001", "Test User",
        email="test@example.com", phone="+15555550101",
    )
    assert customer["id"] == "test_cust_001"
    assert customer["name"] == "Test User"


def test_customer_lookup_by_email():
    """Verify customer lookup by email."""
    import app
    app.init_db()
    app.register_customer("test_cust_002", "Email User", email="lookup@example.com")
    found = app.lookup_customer_by_email("lookup@example.com")
    assert found is not None
    assert found["name"] == "Email User"


def test_customer_lookup_by_phone():
    """Verify customer lookup by phone."""
    import app
    app.init_db()
    app.register_customer("test_cust_003", "Phone User", phone="+15555550102")
    found = app.lookup_customer_by_phone("+15555550102")
    assert found is not None
    assert found["name"] == "Phone User"


def test_resolve_customer():
    """Verify customer resolution by email or phone."""
    import app
    app.init_db()
    app.register_customer(
        "test_cust_004", "Resolve User",
        email="resolve@example.com", phone="+15555550103",
    )
    by_email = app.resolve_customer(email="resolve@example.com")
    assert by_email is not None
    assert by_email["id"] == "test_cust_004"

    by_phone = app.resolve_customer(phone="+15555550103")
    assert by_phone is not None
    assert by_phone["id"] == "test_cust_004"


def test_resolve_unknown_customer():
    """Verify resolve_customer returns None for unknown identifiers."""
    import app
    app.init_db()
    assert app.resolve_customer(email="nobody@example.com") is None
    assert app.resolve_customer(phone="+10000000000") is None


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


def test_customers_endpoint():
    """Verify customers endpoint returns 200."""
    import app
    app.init_db()
    with app.app.test_client() as client:
        resp = client.get("/customers")
        assert resp.status_code == 200


def test_register_customer_endpoint():
    """Verify customer registration endpoint."""
    import app
    app.init_db()
    with app.app.test_client() as client:
        resp = client.post("/customers/register", json={
            "id": "api_cust_001",
            "name": "API User",
            "email": "api@example.com",
            "phone": "+15555550104",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["status"] == "registered"


def test_register_customer_requires_fields():
    """Verify /customers/register rejects requests without required fields."""
    import app
    with app.app.test_client() as client:
        resp = client.post("/customers/register", json={})
        assert resp.status_code == 400


def test_customer_context_endpoint():
    """Verify customer context endpoint."""
    import app
    app.init_db()
    app.register_customer("ctx_cust_001", "Context User")
    app.store_message("ctx_cust_001", "email", "user", "Test email")
    with app.app.test_client() as client:
        resp = client.get("/customers/ctx_cust_001/context")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["customer_id"] == "ctx_cust_001"
        assert data["message_count"] >= 1


# Cleanup test DB after all tests
def teardown_module():
    db_path = os.environ.get("DB_PATH", "test_conversations.db")
    if os.path.exists(db_path):
        os.remove(db_path)
