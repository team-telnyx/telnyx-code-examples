"""Smoke test — verifies app.py imports and registers expected routes without a server."""

import os

os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("TELNYX_API_KEY", "test-key")

import app as campaign_app  # noqa: E402


def test_module_loads():
    assert campaign_app.app is not None


def test_routes_registered():
    rules = {r.rule for r in campaign_app.app.url_map.iter_rules()}
    for route in ("/health", "/campaign/create", "/campaign/watch",
                  "/campaign/report", "/campaign/teardown"):
        assert route in rules, f"missing route {route}"


def test_retry_bounds_validation():
    campaign_app.validate_retry_fields(3, 300)
    for bad in [(-1, 300), (11, 300), (3, 30), (3, 90000), (3, 0), (0, 300)]:
        try:
            campaign_app.validate_retry_fields(*bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for {bad}")


def test_spread_schedule_evenly_spaced():
    times = campaign_app.spread_schedule("2026-10-20T15:00:00Z", 4, 45)
    assert len(times) == 4
    assert times[0].startswith("2026-10-20T15:00:00")
    assert times[-1].startswith("2026-10-20T15:45:00")


def test_clock_restart_assertion_flags_violation():
    attempts = [
        {"attempt_number": 1, "attempted_at": "2026-10-20T15:00:00Z", "call_status": "no-answer"},
        {"attempt_number": 2, "attempted_at": "2026-10-20T15:01:00Z", "call_status": "completed"},
    ]
    violations = campaign_app._assert_clock_restart(attempts, 300)
    assert violations, "expected a clock-restart violation"


def test_health_route():
    client = campaign_app.app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_sms_guard_never_issues_real_request():
    """The SMS guard is a documented-constraint demonstration only."""
    guard = campaign_app._run_sms_guard()
    assert guard["status"] == 400
    assert guard["demo"] is True


def test_report_has_all_required_fields():
    report = campaign_app.build_report()
    for field in ("total_events", "reached_first_attempt", "reached_on_retry",
                  "final_failures_by_call_status", "cancelled", "total_attempts",
                  "configured_budget"):
        assert field in report, f"missing report field {field}"


def test_watch_loop_is_callable():
    assert callable(campaign_app.watch_loop)
    assert campaign_app.WATCH_POLL_SECS == 30
