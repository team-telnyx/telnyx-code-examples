"""
Smoke test for the WhatsApp Coexistence Sync Monitor.

Verifies the app loads, routes are registered, and the core components
(StateChecker, MessageLogger) work as expected.

Run with: python -m pytest smoke_test.py -v
"""

import json
import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def set_test_env(monkeypatch):
    """Set test environment variables before importing the app."""
    monkeypatch.setenv("TELNYX_API_KEY", "test_key")
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", "test_public_key")
    monkeypatch.setenv("WABA_ID", "test_waba")
    monkeypatch.setenv("WHATSAPP_NUMBER", "+15551234567")
    monkeypatch.setenv("DEMO_MODE", "true")
    # Use a temp file for the echo log
    tmpdir = tempfile.mkdtemp()
    monkeypatch.setenv("ECHO_LOG_PATH", str(Path(tmpdir) / "echo_log.jsonl"))


def test_app_imports_and_routes():
    """Verify the app loads and registers the expected routes."""
    import app

    assert app.app is not None
    rules = [rule.rule for rule in app.app.url_map.iter_rules()]
    assert "/webhooks/whatsapp/echo" in rules
    assert "/health" in rules


def test_state_checker_demo_mode():
    """In demo mode, the StateChecker returns an active state."""
    import app

    checker = app.StateChecker(
        waba_id="test_waba",
        phone_number="+15551234567",
        ttl_seconds=60,
    )
    state = checker.get_state()
    assert state["is_on_biz_app"] is True
    assert state["coexistence_state"] == "active"
    assert checker.is_active() is True


def test_message_logger_appends():
    """The MessageLogger appends valid JSONL lines."""
    import app

    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
        log_path = f.name

    logger = app.MessageLogger(log_path)
    event = {
        "timestamp": "2025-01-01T00:00:00+00:00",
        "event_id": "evt_123",
        "event_type": "message.echo",
        "origin": "whatsapp_business_app",
        "from": "+15551234567",
        "to": "+15559876543",
        "text": "Hello from the app",
        "message_id": "msg_456",
        "cost": None,
    }
    logger.append(event)

    with open(log_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert parsed["event_id"] == "evt_123"
    assert parsed["cost"] is None

    os.unlink(log_path)


def test_webhook_rejects_invalid_signature():
    """POST without a valid signature returns 401."""
    import app

    client = app.app.test_client()
    response = client.post(
        "/webhooks/whatsapp/echo",
        data=b'{"event_type": "message.echo", "data": {}}',
        headers={
            "telnyx-signature-ed25519": "invalid",
            "telnyx-timestamp": "0",
        },
    )
    assert response.status_code == 401


def test_health_endpoint():
    """The health endpoint returns 200."""
    import app

    client = app.app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}
