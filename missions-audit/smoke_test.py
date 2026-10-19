"""Smoke test — verifies app.py imports, routes, worker demo-mode safety,
failure path, and audit report shape.

All Telnyx network calls are stubbed via monkeypatch so the test runs offline.
"""

import os

os.environ.setdefault("TELNYX_API_KEY", "test_key_for_smoke")
os.environ.setdefault("DEMO_MODE", "true")

import app as app_module  # noqa: E402


def test_module_loads() -> None:
    assert app_module.app is not None


def test_expected_routes_registered() -> None:
    rules = {r.rule for r in app_module.app.url_map.iter_rules()}
    expected = {
        "/missions",
        "/missions/<mission_id>/runs",
        "/missions/<mission_id>/runs/<run_id>/steps",
        "/missions/<mission_id>/runs/<run_id>/execute",
        "/missions/audit/<mission_id>/<run_id>",
        "/health",
    }
    missing = expected - rules
    assert not missing, f"missing routes: {missing}"


def test_enums_present() -> None:
    assert "succeeded" in app_module.RUN_STATUSES
    assert "failed" in app_module.RUN_STATUSES
    assert "completed" in app_module.STEP_STATUSES
    assert "custom" in app_module.EVENT_TYPES


def test_health_endpoint() -> None:
    client = app_module.app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_create_mission_requires_objective() -> None:
    client = app_module.app.test_client()
    resp = client.post("/missions", json={})
    assert resp.status_code == 400
    assert "objective" in resp.get_json()["error"]


def test_execute_requires_three_step_ids() -> None:
    client = app_module.app.test_client()
    resp = client.post("/missions/m/runs/r/execute", json={"step_ids": ["a", "b"]})
    assert resp.status_code == 400
    assert "step_ids" in resp.get_json()["error"]


def test_execute_rejects_invalid_path_params() -> None:
    client = app_module.app.test_client()
    resp = client.post(
        "/missions/../etc/runs/run_1/execute",
        json={"step_ids": ["stp_1", "stp_2", "stp_3"]},
    )
    # Flask routing will 404 on the traversal; a well-formed-but-invalid id
    # must be rejected with 400 by our validator.
    assert resp.status_code in (400, 404)


def _stub_missions(monkeypatch, calls, fail_step3=False):
    """Stub all Missions + assistant + scheduled-event calls; record them."""

    def fake_request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path.endswith("/steps") and method == "post":
            return {"steps": [
                {"id": "stp_1", "name": "provision assistant", "status": "pending"},
                {"id": "stp_2", "name": "schedule outreach call", "status": "pending"},
                {"id": "stp_3", "name": "verify outcome", "status": "pending"},
            ]}
        if path.endswith("/steps") and method == "get":
            return {"steps": [
                {"id": "stp_1", "name": "provision assistant", "status": "pending"},
                {"id": "stp_2", "name": "schedule outreach call", "status": "pending"},
                {"id": "stp_3", "name": "verify outcome", "status": "pending"},
            ]}
        if path.endswith("/telnyx-agents") and method == "get":
            return {"telnyx_agents": [
                {"run_id": "run_1", "telnyx_agent_id": "asst_1",
                 "created_at": "2026-01-01T00:00:00+00:00"},
            ]}
        if path.endswith("/events") and method == "get":
            return {"events": []}
        if "/runs/" in path and method == "get" and path.count("/") == 4:
            return {"id": "run_1", "mission_id": "m", "status": "running",
                    "result_summary": None, "result_payload": None}
        if path == "/ai/missions/m" and method == "get":
            return {"id": "m", "objective": "Verify 3 clinic contacts can be reached"}
        return {"id": "x", "status": "completed"}

    monkeypatch.setattr(app_module.telnyx, "request", fake_request)
    monkeypatch.setattr(
        app_module.telnyx.AI.Assistant, "create",
        lambda **kw: type("A", (), {"id": "asst_1"})(),
    )


def test_execute_demo_mode_makes_no_scheduled_event_call(monkeypatch) -> None:
    calls = []
    _stub_missions(monkeypatch, calls)
    client = app_module.app.test_client()
    resp = client.post(
        "/missions/m/runs/run_1/execute",
        json={"step_ids": ["stp_1", "stp_2", "stp_3"]},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["call_status"] == "completed"

    # Assistant was created (or reused).
    assert body["assistant_id"] == "asst_1"

    # No scheduled-events network call in demo mode.
    assert not any("scheduled_events" in c[1] for c in calls)

    # Each of the three steps was PATCHed to in_progress and completed.
    for step_id in ("stp_1", "stp_2", "stp_3"):
        patches = [c for c in calls
                   if c[0] == "patch" and c[1].endswith(f"/steps/{step_id}")]
        statuses = [p[2]["json"]["status"] for p in patches]
        assert "in_progress" in statuses, f"{step_id} never went in_progress"
        assert "completed" in statuses, f"{step_id} never went completed"

    # step_started and step_completed events were emitted.
    event_types = [c[2]["json"]["event_type"] for c in calls
                   if c[1].endswith("/events") and c[0] == "post"]
    assert event_types.count("step_started") == 3
    assert event_types.count("step_completed") == 3

    # Run was PATCHed to succeeded.
    run_patches = [c for c in calls if c[0] == "patch" and c[1].endswith("/runs/run_1")]
    assert run_patches and run_patches[0][2]["json"]["status"] == "succeeded"

    # Custom event emitted with the four required property keys.
    custom = [c for c in calls if c[1].endswith("/events") and c[0] == "post"
              and c[2]["json"]["event_type"] == "custom"]
    assert custom
    props = custom[0][2]["json"]["properties"]
    assert set(props) == {
        "scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number",
    }


def test_execute_failure_path_marks_step_and_run_failed(monkeypatch) -> None:
    calls = []
    _stub_missions(monkeypatch, calls)

    def fake_request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path.endswith("/steps") and method == "get":
            return {"steps": [
                {"id": "stp_1", "name": "provision assistant", "status": "pending"},
                {"id": "stp_2", "name": "schedule outreach call", "status": "pending"},
                {"id": "stp_3", "name": "verify outcome", "status": "pending"},
            ]}
        if path.endswith("/telnyx-agents") and method == "get":
            return {"telnyx_agents": []}
        if "/runs/" in path and method == "get" and path.count("/") == 4:
            return {"id": "run_1", "mission_id": "m", "status": "running",
                    "result_summary": None, "result_payload": None}
        return {"id": "x", "status": "completed"}

    monkeypatch.setattr(app_module.telnyx, "request", fake_request)
    monkeypatch.setattr(
        app_module.telnyx.AI.Assistant, "create",
        lambda **kw: type("A", (), {"id": "asst_1"})(),
    )
    # Force live mode + a failed poll by stubbing the poll helper.
    monkeypatch.setattr(app_module, "DEMO_MODE", False)
    monkeypatch.setattr(app_module, "ASSISTANT_PHONE_NUMBER", "+15551234567")

    invoked = {"create": 0, "poll": 0}

    def fake_create_scheduled_event(assistant_id):
        invoked["create"] += 1
        return {"id": "evt_1", "status": "pending"}

    def fake_poll_scheduled_event(assistant_id, event_id):
        invoked["poll"] += 1
        return "failed"

    monkeypatch.setattr(app_module, "_create_scheduled_event", fake_create_scheduled_event)
    monkeypatch.setattr(app_module, "_poll_scheduled_event", fake_poll_scheduled_event)

    client = app_module.app.test_client()
    resp = client.post(
        "/missions/m/runs/run_1/execute",
        json={"step_ids": ["stp_1", "stp_2", "stp_3"]},
    )
    assert resp.status_code == 200
    assert resp.get_json()["call_status"] == "failed"

    # The patched helpers were actually invoked.
    assert invoked["create"] == 1
    assert invoked["poll"] == 1

    step_failed = [c for c in calls if c[0] == "patch" and c[1].endswith("/steps/stp_3")]
    assert step_failed and step_failed[0][2]["json"]["status"] == "failed"
    run_patches = [c for c in calls if c[0] == "patch" and c[1].endswith("/runs/run_1")]
    assert run_patches and run_patches[0][2]["json"]["status"] == "failed"
    assert "failing_step_id" in run_patches[0][2]["json"]["result_payload"]


def test_execute_rejects_foreign_step_ids(monkeypatch) -> None:
    calls = []
    _stub_missions(monkeypatch, calls)
    client = app_module.app.test_client()
    resp = client.post(
        "/missions/m/runs/run_1/execute",
        json={"step_ids": ["stp_1", "stp_2", "st
