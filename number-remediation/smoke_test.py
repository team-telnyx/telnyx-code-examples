"""Smoke test: verifies the remediation desk module loads and routes exist."""
import os

os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("TELNYX_API_KEY", "test_key")
os.environ.setdefault("TELNYX_ENTERPRISE_ID", "test_enterprise")

import app as remediation_app  # noqa: E402


def test_module_loads():
    assert remediation_app.app is not None


def test_expected_routes_registered():
    rules = {r.rule for r in remediation_app.app.url_map.iter_rules()}
    for path in (
        "/health",
        "/reputation/check",
        "/remediation/submit",
        "/remediation/<request_id>",
        "/remediation/<request_id>/poll",
        "/remediation/<request_id>/report",
        "/webhooks/remediation",
    ):
        assert path in rules, f"missing route: {path}"


def test_validation_rejects_overlong_purpose():
    errors = remediation_app.validate_submission(
        ["+15550000001"], "x" * 2001, None, None
    )
    assert any("call_purpose" in e for e in errors)


def test_validation_rejects_too_many_numbers():
    numbers = [f"+1555{i:07d}" for i in range(2001)]
    errors = remediation_app.validate_submission(numbers, "ok", None, None)
    assert any("exceeds limit" in e for e in errors)


def test_validation_rejects_malformed_e164():
    errors = remediation_app.validate_submission(
        ["not-a-number"], "ok", None, None
    )
    assert any("E.164" in e for e in errors)


def test_demo_submit_returns_202_contract_fields():
    body = remediation_app.submit_remediation(
        ["+15550000001", "+15550000002"],
        "Outbound appointment reminders for our dental clinic.",
    )
    assert body["status"] == "pending"
    assert body["phone_numbers_count"] == 2
    assert body["phone_numbers_submitted"] == 2
    assert body["phone_numbers_ineligible"] == 0


def test_report_renders_all_buckets():
    detail = remediation_app.get_remediation("demo-remediation-request")
    report = remediation_app.render_report(detail)
    for bucket in remediation_app.OUTCOME_BUCKETS:
        assert bucket in report
    assert "tier1_completed_at" in report
    assert "tier2_completed_at" in report


def test_webhook_processes_tiered_events():
    """Post tier1_complete then completed; both must be accepted."""
    client = remediation_app.app.test_client()
    for event_type in (
        "number_reputation.remediation.tier1_complete",
        "number_reputation.remediation.completed",
    ):
        resp = client.post(
            "/webhooks/remediation",
            json={
                "data": {
                    "event_type": event_type,
                    "payload": {
                        "id": "demo-remediation-request",
                        "status": "in_progress",
                    },
                }
            },
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        assert resp.get_json()["event_type"] == event_type


def test_webhook_rejects_unparseable_payload():
    """A non-JSON body must be rejected with 400."""
    client = remediation_app.app.test_client()
    resp = client.post(
        "/webhooks/remediation",
        data=b"not json",
        content_type="application/json",
    )
    assert resp.status_code == 400


def test_reputation_check_validates_input():
    """Empty / malformed phone_numbers must return 400."""
    client = remediation_app.app.test_client()
    resp = client.post("/reputation/check", json={"phone_numbers": []})
    assert resp.status_code == 400
    resp = client.post("/reputation/check", json={"phone_numbers": ["bad"]})
    assert resp.status_code == 400


def test_webhook_rejects_unsigned_payload_when_verification_enabled(monkeypatch):
    """When a public key is configured, unsigned payloads must be rejected 400."""
    monkeypatch.setattr(remediation_app, "PUBLIC_KEY", "test_public_key")
    monkeypatch.setattr(remediation_app, "client", object())

    def _fail_unwrap(*args, **kwargs):
        raise ValueError("bad signature")

    monkeypatch.setattr(
        remediation_app.client, "webhooks", type("W", (), {"unwrap": staticmethod(_fail_unwrap)})(),
        raising=False,
    )
    client = remediation_app.app.test_client()
    resp = client.post(
        "/webhooks/remediation",
        json={"data": {"event_type": "number_reputation.remediation.completed"}},
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid signature"


def test_poll_returns_terminal_status_synchronously():
    """Polling is synchronous and returns the terminal detail without threads."""
    detail = remediation_app.poll_until_terminal("demo-remediation-request", max_polls=1)
    assert detail["status"] == "completed"
    assert "results" in detail
