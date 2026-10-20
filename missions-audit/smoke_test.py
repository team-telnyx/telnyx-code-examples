"""Smoke test — imports every workflow script and verifies each exposes _main()."""
from __future__ import annotations

import importlib

import pytest

MODULES = [
    "app",
    "telnyx_client",
    "create_mission",
    "start_run",
    "plan_steps",
    "execute",
    "audit",
]


@pytest.mark.parametrize("name", MODULES)
def test_module_loads(name: str) -> None:
    importlib.import_module(name)


@pytest.mark.parametrize("name", [m for m in MODULES if m != "telnyx_client"])
def test_module_exposes_main(name: str) -> None:
    module = importlib.import_module(name)
    assert hasattr(module, "_main"), f"{name} must expose a _main() callable"
    assert callable(module._main)


def test_app_dispatcher_lists_workflow_scripts() -> None:
    app = importlib.import_module("app")
    scripts = [script for script, _ in app.WORKFLOW]
    for expected in ("create_mission.py", "start_run.py", "plan_steps.py",
                     "execute.py", "audit.py"):
        assert expected in scripts


def test_plan_steps_has_three_step_plan() -> None:
    plan_steps = importlib.import_module("plan_steps")
    assert len(plan_steps.PLAN) == 3
    assert plan_steps.PLAN[0]["name"] == "provision assistant"


def test_audit_documents_full_run_status_enum() -> None:
    audit = importlib.import_module("audit")
    statuses = {status for status, _ in audit.RUN_STATUS_TABLE}
    assert statuses == {"pending", "running", "paused", "succeeded", "failed", "cancelled"}


def test_execute_has_step_transition_helper() -> None:
    execute = importlib.import_module("execute")
    assert callable(execute._run_step)
    assert callable(execute._poll_event)
    assert issubclass(execute.StepFailedError, RuntimeError)


def test_telnyx_client_validates_e164() -> None:
    tc = importlib.import_module("telnyx_client")
    assert tc.E164_RE.match("+15551234567")
    assert not tc.E164_RE.match("+1555XXXXXXXX")
    assert not tc.E164_RE.match("5551234567")


def test_unwrap_handles_dict_and_wrapped_shapes() -> None:
    tc = importlib.import_module("telnyx_client")

    class _Wrapped:
        def __init__(self, data: object) -> None:
            self.data = data

    class _Body:
        def __init__(self, body: object) -> None:
            self.body = body

    assert tc.unwrap({"id": "x"}) == {"id": "x"}
    assert tc.unwrap(_Wrapped({"id": "y"})) == {"id": "y"}
    assert tc.unwrap(_Body({"id": "z"})) == {"id": "z"}
