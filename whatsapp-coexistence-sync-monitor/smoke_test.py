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
        "origin_matches_biz_app": True,
        "text": "Hello from the app",
        "message_id": "msg_456",
        "billing_confirmed": True,
    }
    logger.append(event)

    with open(log_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert parsed["event_id"] == "evt_123"
    assert parsed["billing_confirmed"] is True

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


# ---------------------------------------------------------------------------
# Helpers for valid-signature webhook tests (live Ed25519 verification path)
# ---------------------------------------------------------------------------
import base64
import time

import nacl.signing

_signing_key = nacl.signing.SigningKey.generate()
B64_PUBLIC_KEY = base64.b64encode(bytes(_signing_key.verify_key)).decode("ascii")


def _signed_headers(body: bytes, timestamp: int | None = None) -> dict:
    """Build Telnyx-style Ed25519 headers signing '<timestamp>|<body>'."""
    ts = int(time.time()) if timestamp is None else timestamp
    signature = _signing_key.sign(f"{ts}|".encode("utf-8") + body).signature
    return {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": base64.b64encode(signature).decode("ascii"),
        "telnyx-timestamp": str(ts),
    }


def _echo_body(origin="whatsapp_business_app", cost=None, event_id="evt_live_1"):
    return json.dumps(
        {
            "event_type": "message.echo",
            "data": {
                "id": event_id,
                "origin": origin,
                "payload": {
                    "from": "+15559990000",
                    "to": "+15551234567",
                    "text": "Hello from the WhatsApp Business app",
                    "id": "wamid.live1",
                    "cost": cost,
                },
            },
        }
    ).encode("utf-8")


def test_webhook_accepts_valid_signature(monkeypatch):
    """A correctly signed message.echo webhook is accepted and logged."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    body = _echo_body(cost={"amount": None, "currency": None})
    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=_signed_headers(body)
    )
    assert response.status_code == 200
    assert response.json == {"ok": True}

    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["event_type"] == "message.echo"
    assert entry["origin"] == "whatsapp_business_app"
    assert entry["origin_matches_biz_app"] is True
    assert entry["billing_confirmed"] is True
    assert entry["text"] == "Hello from the WhatsApp Business app"
    # PII minimization: raw phone numbers and monetary amounts are never persisted
    assert "from" not in entry
    assert "to" not in entry
    assert "cost" not in entry


def test_webhook_accepts_absent_cost_field(monkeypatch):
    """A null/absent cost is still flagged billing_confirmed (AC #3)."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    body = _echo_body(cost=None, event_id="evt_live_2")
    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=_signed_headers(body)
    )
    assert response.status_code == 200

    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    last = [e for e in entries if e["event_id"] == "evt_live_2"][0]
    assert last["billing_confirmed"] is True


def test_webhook_flags_unexpected_billing(monkeypatch):
    """A non-null cost.amount means a billing event — must NOT be billing_confirmed."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    body = _echo_body(cost={"amount": 0.005, "currency": "USD"}, event_id="evt_live_3")
    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=_signed_headers(body)
    )
    assert response.status_code == 200

    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    last = [e for e in entries if e["event_id"] == "evt_live_3"][0]
    assert last["billing_confirmed"] is False


def test_webhook_flags_unexpected_origin(monkeypatch):
    """An origin other than 'whatsapp_business_app' is flagged in the log."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    body = _echo_body(origin="cloud_api", event_id="evt_live_4")
    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=_signed_headers(body)
    )
    assert response.status_code == 200

    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    last = [e for e in entries if e["event_id"] == "evt_live_4"][0]
    assert last["origin"] == "cloud_api"
    assert last["origin_matches_biz_app"] is False


def test_webhook_rejects_wrong_signing_key(monkeypatch):
    """A body signed with a different key fails verification → 401."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    other_key = nacl.signing.SigningKey.generate()
    body = _echo_body()
    ts = int(time.time())
    bad_sig = other_key.sign(f"{ts}|".encode("utf-8") + body).signature
    headers = _signed_headers(body)
    headers["telnyx-signature-ed25519"] = base64.b64encode(bad_sig).decode("ascii")

    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=headers
    )
    assert response.status_code == 401

    # Nothing must be appended to the echo log
    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    assert all(e["event_id"] != "evt_live_5" for e in entries) if entries else True


def test_webhook_skipped_when_not_active(monkeypatch):
    """Valid echo while the number is NOT active → 200 skip, no log entry."""
    import app

    monkeypatch.setattr(app, "TELNYX_PUBLIC_KEY", B64_PUBLIC_KEY)

    app.state_checker._cache["state"] = (
        time.time(),
        {"phone_number": app.WHATSAPP_NUMBER, "is_on_biz_app": True,
         "coexistence_state": "sync_pending"},
    )

    body = _echo_body(event_id="evt_live_6")
    response = app.app.test_client().post(
        "/webhooks/whatsapp/echo", data=body, headers=_signed_headers(body)
    )
    assert response.status_code == 200
    assert response.json == {"ok": "skipped", "reason": "number_not_active"}

    with open(app.ECHO_LOG_PATH, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    assert all(e["event_id"] != "evt_live_6" for e in entries) if entries else True


def test_state_checker_live_mode_uses_correct_sdk_path():
    """StateChecker._fetch_state (live) must call the real SDK v4 path."""
    import inspect

    import app

    source = inspect.getsource(app.StateChecker._fetch_state)
    assert "client.whatsapp.business_accounts.phone_numbers.list" in source
    # The old broken call must be gone
    assert "client.whatsapp_business_accounts.phone_numbers(" not in source


def test_signature_verification_uses_key_kwarg():
    """unwrap must be invoked with the `key=` kwarg (SDK >= 4.x)."""
    import inspect

    import app

    source = inspect.getsource(app.verify_webhook_signature)
    assert "key=TELNYX_PUBLIC_KEY" in source
    assert "public_key=" not in source
