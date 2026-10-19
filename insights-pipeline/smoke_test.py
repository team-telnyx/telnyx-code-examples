"""Smoke test for the insights-pipeline Flask app.

Verifies the module imports, the Flask app is constructed, the expected
routes are registered, the schema definitions are well-formed, webhook
signature verification is enforced against the REAL SDK path with a
known-good signed payload, the store round-trips, and the scorecard
aggregation / --strict / --date paths behave as specified.
"""

import importlib
import json
import time

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)


@pytest.fixture(scope="module")
def app_module():
    """Import app.py as a module."""
    return importlib.import_module("app")


@pytest.fixture()
def client(app_module):
    """Flask test client."""
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


@pytest.fixture()
def store(app_module, tmp_path, monkeypatch):
    """Point the module at a temporary JSON-lines store."""
    path = tmp_path / "conversations.json"
    monkeypatch.setattr(app_module, "CONVERSATIONS_STORE", path)
    return path


@pytest.fixture()
def signing_key():
    """Generate a fresh Ed25519 keypair for signature tests."""
    private = Ed25519PrivateKey.generate()
    public_bytes = private.public_key().public_bytes(
        Encoding.Raw, PublicFormat.Raw
    )
    return private, public_bytes.hex()


def _sign(private, timestamp: str, body: bytes) -> str:
    """Produce the Telnyx Ed25519 signature over `timestamp|body`."""
    signed = f"{timestamp}|".encode() + body
    return private.sign(signed).hex()


def test_module_imports(app_module):
    """The main module imports without error."""
    assert app_module is not None


def test_flask_app_exists(app_module):
    """A Flask app instance is exposed."""
    assert hasattr(app_module, "app")
    assert app_module.app is not None


def test_expected_routes_registered(app_module):
    """The webhook and health routes are registered."""
    rules = {rule.rule for rule in app_module.app.url_map.iter_rules()}
    assert "/webhooks/telnyx" in rules
    assert "/health" in rules


def test_schemas_have_required_fields(app_module):
    """Every template schema declares required fields and enums."""
    for schema in (
        app_module.SENTIMENT_SCHEMA,
        app_module.COMPLIANCE_SCHEMA,
        app_module.ESCALATION_SCHEMA,
    ):
        assert schema["type"] == "object"
        assert schema["required"]
        assert schema["properties"]


def test_templates_defined(app_module):
    """Three insight templates are defined with names and schemas."""
    assert len(app_module.TEMPLATES) == 3
    names = {t["name"] for t in app_module.TEMPLATES}
    assert names == {"sentiment-v1", "compliance-v1", "escalation-v1"}


def test_validate_record_rejects_missing_field(app_module):
    """The validator rejects a record missing a required field."""
    bad = {"frustration_level": 2, "overall_sentiment": "negative"}
    assert app_module._validate_record(bad, app_module.SENTIMENT_SCHEMA) is False


def test_validate_record_accepts_valid(app_module):
    """The validator accepts a fully-populated valid record."""
    good = {
        "positivity_score": 3,
        "frustration_level": 2,
        "overall_sentiment": "mixed",
        "key_emotions": ["frustrated"],
    }
    assert app_module._validate_record(good, app_module.SENTIMENT_SCHEMA) is True


# --- webhook signature enforcement (REAL SDK path) --------------------------


def test_webhook_rejects_forged_signature(client):
    """A forged/unsigned payload is rejected with 400."""
    resp = client.post(
        "/webhooks/telnyx",
        data=json.dumps({"data": {"event_type": "call.conversation.insights_generated"}}),
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": "deadbeef",
            "telnyx-timestamp": "1700000000",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid signature"}


def test_webhook_accepts_valid_signature(
    client, app_module, store, monkeypatch, signing_key
):
    """A validly-signed event appends the conversation ID to the store.

    This exercises the REAL telnyx.Webhook.construct_event path — no
    monkeypatched stub — by signing the payload with a known test key.
    """
    private, public_hex = signing_key
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", public_hex)

    event = {
        "data": {
            "id": "evt_test",
            "event_type": "call.conversation.insights_generated",
            "occurred_at": "2026-10-20T14:03:11Z",
            "payload": {"conversation_id": "conv_test_1", "insights": []},
        }
    }
    body = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    signature = _sign(private, timestamp, body)

    resp = client.post(
        "/webhooks/telnyx",
        data=body,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": signature,
            "telnyx-timestamp": timestamp,
        },
    )
    assert resp.status_code == 200
    assert resp.get_json() == {"received": True}

    rows = app_module.read_conversations()
    assert any(r["conversation_id"] == "conv_test_1" for r in rows)


def test_webhook_rejects_tampered_body(
    client, app_module, store, monkeypatch, signing_key
):
    """A body modified after signing is rejected with 400."""
    private, public_hex = signing_key
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", public_hex)

    event = {
        "data": {
            "id": "evt_test",
            "event_type": "call.conversation.insights_generated",
            "occurred_at": "2026-10-20T14:03:11Z",
            "payload": {"conversation_id": "conv_test_1", "insights": []},
        }
    }
    body = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    signature = _sign(private, timestamp, body)

    tampered = body.replace(b"conv_test_1", b"conv_evil_1")

    resp = client.post(
        "/webhooks/telnyx",
        data=tampered,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": signature,
            "telnyx-timestamp": timestamp,
        },
    )
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid signature"}


def test_store_round_trip(app_module, store):
    """append_conversation writes a row that read_conversations returns."""
    app_module.append_conversation("conv_round_trip")
    rows = app_module.read_conversations()
    assert rows[-1]["conversation_id"] == "conv_round_trip"
    assert "received_at" in rows[-1]


# --- scorecard --------------------------------------------------------------


def _fake_insights(records):
    def _fetch(conversation_id):
        return records

    return _fetch


def test_scorecard_aggregates_valid_records(app_module, store, monkeypatch):
    """Valid records are aggregated into the three buckets."""
    app_module.append_conversation("conv_valid")
    records = [
        {
            "name": "sentiment-v1",
            "status": "completed",
            "result": {
                "positivity_score": 2,
                "frustration_level": 4,
                "overall_sentiment": "negative",
                "key_emotions": ["frustrated"],
            },
        },
        {
            "name": "compliance-v1",
            "status": "completed",
            "result": {
                "verified_identity": True,
                "compliance_flags": ["disclosure_missing", "escalation_requested"],
            },
        },
        {
            "name": "escalation-v1",
            "status": "completed",
            "result": {"escalation_reason": "caller_request", "agent_performed_well": True},
        },
    ]
    monkeypatch.setattr(app_module, "_fetch_insights", _fake_insights(records))

    card = app_module.render_scorecard(None, None, False)
    assert card["sentiment_distribution"] == {"negative": 1}
    assert card["compliance_flag_rates"] == {
        "disclosure_missing": 1,
        "escalation_requested": 1,
    }
    assert card["escalation_breakdown"] == {"caller_request": 1}
    assert card["schema_invalid"] == []
    assert card["pending"] == []


def test_scorecard_strict_flags_synthetic_invalid(app_module, store, monkeypatch):
    """--strict flags demo-synthetic-invalid and excludes it from aggregates."""
    app_module.append_conversation("conv_valid")
    records = [
        {
            "name": "sentiment-v1",
            "status": "completed",
            "result": {
                "positivity_score": 4,
                "frustration_level": 1,
                "overall_sentiment": "positive",
                "key_emotions": ["satisfied"],
            },
        }
    ]
    monkeypatch.setattr(app_module, "_fetch_insights", _fake_insights(records))

    card = app_module.render_scorecard(None, None, True)
    assert app_module.SYNTHETIC_INVALID_ID in card["schema_invalid"]
    # The synthetic record's sentiment must NOT appear in the aggregates.
    assert card["sentiment_distribution"] == {"positive": 1}


def test_scorecard_date_filter(app_module, store, monkeypatch):
    """--date filters store rows by received_at prefix."""
    app_module.append_conversation("conv_old")
    app_module.append_conversation("conv_new")

    # Rewrite the store so one row is on a different date.
    rows = app_module.read_conversations()
    rows[0]["received_at"] = "2026-10-19T10:00:00+00:00"
    rows[1]["received_at"] = "2026-10-20T10:00:00+00:00"
    with store.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")

    seen = []

    def _fetch(conversation_id):
        seen.append(conversation_id)
        return []

    monkeypatch.setattr(app_module, "_fetch_insights", _fetch)

    app_module.render_scorecard("2026-10-20", None, False)
    assert seen == ["conv_new"]


def test_scorecard_conversation_id_override(app_module, store, monkeypatch):
    """--conversation-id overrides the store for a manual run."""
    app_module.append_conversation("conv_from_store")

    seen = []

    def _fetch(conversation_id):
        seen.append(conversation_id)
        return []

    monkeypatch.setattr(app_module, "_fetch
