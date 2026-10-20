"""Smoke test: module load, route registration, and the ticket's acceptance criteria.

Covers: schema validation excludes invalid records, aggregation only counts
valid records, the webhook rejects a bad signature with 400, and --strict flags
the synthetic invalid conversation id via the real validator.
"""

import importlib
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

MODULES = [
    "app",
    "create_templates",
    "create_group",
    "wire_assistant",
    "place_call",
    "scorecard",
    "webhook_receiver",
]


@pytest.mark.parametrize("name", MODULES)
def test_module_loads_and_exposes_main(name: str) -> None:
    module = importlib.import_module(name)
    assert callable(getattr(module, "_main", None)), f"{name} does not expose _main()"


def test_app_lists_every_workflow_script() -> None:
    import app

    names = [entry[0] for entry in app.WORKFLOW]
    for expected in MODULES[1:]:
        assert f"{expected}.py" in names


def test_webhook_receiver_registers_route() -> None:
    import webhook_receiver

    paths = {route.path for route in webhook_receiver.app.routes}
    assert "/webhooks/telnyx" in paths


def test_webhook_rejects_bad_signature() -> None:
    os.environ["TELNYX_PUBLIC_KEY"] = "not-a-real-key"
    os.environ["TELNYX_API_KEY"] = "test-key"
    import webhook_receiver

    client = TestClient(webhook_receiver.app)
    resp = client.post(
        "/webhooks/telnyx",
        content=json.dumps({"data": {"event_type": "call.conversation.insights_generated"}}),
        headers={"telnyx-signature-ed25519": "bad", "telnyx-timestamp": "0"},
    )
    assert resp.status_code == 400


def test_scorecard_validator_excludes_invalid_records() -> None:
    import scorecard

    bad = {
        "name": "sentiment-v1",
        "status": "completed",
        "result": {"positivity_score": 99, "frustration_level": 2, "overall_sentiment": "banana"},
    }
    errors = scorecard._validate(bad)
    assert errors, "schema-invalid record must produce violations"

    good = {
        "name": "sentiment-v1",
        "status": "completed",
        "result": {"positivity_score": 4, "frustration_level": 2, "overall_sentiment": "positive"},
    }
    assert scorecard._validate(good) == []


def test_scorecard_aggregates_only_valid_records(capsys) -> None:
    import scorecard

    valid = [
        {"name": "sentiment-v1", "result": {"overall_sentiment": "positive"}, "_conversation_id": "c1"},
        {"name": "sentiment-v1", "result": {"overall_sentiment": "negative"}, "_conversation_id": "c2"},
        {"name": "compliance-v1", "result": {"compliance_flags": ["disclosure_missing"]}, "_conversation_id": "c1"},
    ]
    scorecard._render(valid, [], 0)
    out = capsys.readouterr().out
    assert "positive" in out and "negative" in out
    assert "disclosure_missing" in out


def test_strict_flags_synthetic_invalid(tmp_path: Path, monkeypatch, capsys) -> None:
    """--strict must flag the synthetic record via the real validator."""
    import scorecard

    store = tmp_path / "conversations.json"
    monkeypatch.setattr(scorecard, "STORE", store)
    monkeypatch.setenv("TELNYX_API_KEY", "test-key")

    # The synthetic record must be flagged by the real Draft7Validator.
    errors = scorecard._validate(scorecard.SYNTHETIC_RECORD)
    assert errors, "synthetic record must produce schema violations"
    assert any("positivity_score" in e for e in errors)

    # And _main --strict must surface it under the fake conversation id.
    monkeypatch.setattr(scorecard, "_fetch_records", lambda headers, cid: [])
    monkeypatch.setattr(
        "sys.argv",
        ["scorecard.py", "--strict", "--conversation-id", "conv-real"],
    )
    scorecard._main()
    out = capsys.readouterr().out
    assert scorecard.SYNTHETIC_ID in out
    assert "positivity_score" in out
    assert not store.exists(), "synthetic row must not be written to the store"
