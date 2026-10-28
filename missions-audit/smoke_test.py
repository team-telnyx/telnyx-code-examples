"""Smoke test - structural checks with no network access."""
from __future__ import annotations

import importlib

import pytest

MODULES = [
    "app",
    "create_mission",
    "start_run",
    "plan_steps",
    "execute",
    "audit",
]


@pytest.mark.parametrize("name", MODULES)
def test_module_imports_and_exposes_main(name: str) -> None:
    module = importlib.import_module(name)
    assert callable(getattr(module, "_main", None)), f"{name} must expose callable _main()"


def test_app_lists_all_workflow_scripts() -> None:
    app = importlib.import_module("app")
    names = [entry[0] for entry in app.WORKFLOW]
    for script in ["create_mission.py", "start_run.py", "plan_steps.py", "execute.py", "audit.py"]:
        assert script in names
    assert app._main(["--list"]) == 0


def test_plan_has_three_valid_steps() -> None:
    plan = importlib.import_module("plan_steps").PLAN
    assert len(plan) == 3
    for i, step in enumerate(plan, start=1):
        assert step["step_id"] and step["description"]
        assert step["sequence"] == i
    assert [s["step_id"] for s in plan] == [
        "provision_assistant",
        "schedule_outreach_call",
        "verify_outcome",
    ]


def test_mask_hides_numbers() -> None:
    execute = importlib.import_module("execute")
    assert execute._mask("+15550001234") == "+1***34"
    assert execute._mask("") == "***"
    assert execute._mask(None) == "***"


def test_e164_validation() -> None:
    execute = importlib.import_module("execute")
    assert execute.E164.match("+15550001234")
    assert not execute.E164.match("15550001234")
    assert not execute.E164.match("+0123")


def test_enum_tables_cover_api_enums() -> None:
    audit = importlib.import_module("audit")
    run_statuses = {name for name, _ in audit.RUN_STATUS_TABLE}
    assert run_statuses == {"pending", "running", "paused", "succeeded", "failed", "cancelled"}
    step_statuses = {name for name, _ in audit.STEP_STATUS_TABLE}
    assert step_statuses == {"pending", "in_progress", "completed", "skipped", "failed"}


def test_demo_mode_defaults_safe() -> None:
    import os
    execute = importlib.import_module("execute")
    if not os.getenv("DEMO_MODE"):
        assert execute.DEMO_MODE is True
