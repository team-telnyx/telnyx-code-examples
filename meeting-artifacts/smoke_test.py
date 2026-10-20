"""Smoke test: verifies app.py imports, routes, and report output."""

import importlib
import os
from pathlib import Path

os.environ["DEMO_MODE"] = "true"
os.environ["TELNYX_ASSISTANT_ID"] = "assistant_test"


def test_module_imports():
    mod = importlib.import_module("app")
    assert mod is not None


def test_helpers_exist():
    mod = importlib.import_module("app")
    for name in (
        "create_meeting_session",
        "get_meeting_session",
        "request_artifact",
        "list_artifacts",
        "get_transcript",
        "wait_for_active",
        "poll_artifacts",
        "write_report",
    ):
        assert callable(getattr(mod, name)), f"missing helper: {name}"


def test_artifact_types_constant():
    mod = importlib.import_module("app")
    assert mod.ARTIFACT_TYPES == ["summary", "action_items", "decisions", "open_questions"]
    assert mod.VALID_ARTIFACT_TYPES == [
        "summary", "action_items", "decisions", "topics", "open_questions", "custom",
    ]


def test_reserved_dynamic_variables_rejected():
    mod = importlib.import_module("app")
    try:
        mod.create_meeting_session(
            "https://meet.google.com/abc-defg-hij",
            dynamic_variables={"meeting_session_id": "x"},
        )
    except ValueError as exc:
        assert "reserved" in str(exc)
    else:
        raise AssertionError("expected ValueError for reserved dynamic_variables key")


def test_meeting_url_validation():
    mod = importlib.import_module("app")
    for bad in ("http://meet.google.com/x", "https://evil.example.com/x"):
        try:
            mod.create_meeting_session(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError for {bad}")


def test_dynamic_variables_constraints():
    mod = importlib.import_module("app")
    try:
        mod.create_meeting_session(
            "https://meet.google.com/abc-defg-hij",
            dynamic_variables={f"k{i}": "v" for i in range(64)},
        )
    except ValueError as exc:
        assert "63" in str(exc)
    else:
        raise AssertionError("expected ValueError for >63 dynamic_variables")


def test_legacy_fields_rejected():
    mod = importlib.import_module("app")
    try:
        mod._reject_legacy_fields({"connection_id": "x"})
    except ValueError as exc:
        assert "legacy" in str(exc)
    else:
        raise AssertionError("expected ValueError for legacy field")


def test_flask_routes_registered():
    mod = importlib.import_module("app")
    rules = {r.rule for r in mod.app.url_map.iter_rules()}
    assert "/webhooks/telnyx" in rules
    assert "/health" in rules


def test_webhook_rejects_unsigned_when_public_key_set(monkeypatch):
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", "fake-public-key")
    mod = importlib.import_module("app")
    importlib.reload(mod)
    client = mod.app.test_client()
    resp = client.post(
        "/webhooks/telnyx",
        json={"data": {"event_type": "session_status_changed"}},
    )
    assert resp.status_code == 400


def test_webhook_rejects_unsigned_in_live_mode(monkeypatch):
    """Live mode with no public key must refuse unsigned webhooks (500)."""
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", "")
    monkeypatch.setenv("DEMO_MODE", "false")
    mod = importlib.import_module("app")
    importlib.reload(mod)
    client = mod.app.test_client()
    resp = client.post(
        "/webhooks/telnyx",
        json={"data": {"event_type": "session_status_changed"}},
    )
    assert resp.status_code == 500
    # restore for other tests
    monkeypatch.setenv("DEMO_MODE", "true")
    importlib.reload(mod)


def test_webhook_accepts_in_demo_mode(monkeypatch):
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", "")
    monkeypatch.setenv("DEMO_MODE", "true")
    mod = importlib.import_module("app")
    importlib.reload(mod)
    client = mod.app.test_client()
    resp = client.post(
        "/webhooks/telnyx",
        json={"data": {"event_type": "artifact_completed", "payload": {"session_id": "s1"}}},
    )
    assert resp.status_code == 200
    assert resp.json["received"] is True


def test_write_report_emits_all_sections(tmp_path: Path):
    mod = importlib.import_module("app")
    artifacts = [
        {"type": "summary", "status": "completed", "content": "the summary"},
        {"type": "action_items", "status": "completed", "content": "the actions"},
        {"type": "decisions", "status": "completed", "content": "the decisions"},
        {"type": "open_questions", "status": "completed", "content": "the questions"},
        {"type": "custom", "status": "failed", "content": None,
         "failure_reason": "content cannot support custom"},
    ]
    path = mod.write_report("sess_test", artifacts, "the transcript", out_dir=tmp_path)
    text = path.read_text(encoding="utf-8")
    assert "## Summary" in text
    assert "## Action Items" in text
    assert "## Decisions" in text
    assert "## Open Questions" in text
    assert "**FAILED**: content cannot support custom" in text
    assert (tmp_path / "transcript.txt").read_text(encoding="utf-8") == "the transcript"


def test_break_artifact_demo_returns_failed():
    mod = importlib.import_module("app")
    arts = mod.list_artifacts("demo-session-0001", break_artifact=True)
    failed = [a for a in arts if a.get("status") == "failed"]
    assert failed, "expected a failed artifact in break_artifact demo mode"
    assert failed[0].get("failure_reason")


def test_wait_for_active_returns_terminal():
    mod = importlib.import_module("app")
    # demo lifecycle reaches active at step 2
    status = mod.wait_for_active("demo-session-0001", timeout=30)
    assert status in ("active", "ended", "failed", "admission_denied")
