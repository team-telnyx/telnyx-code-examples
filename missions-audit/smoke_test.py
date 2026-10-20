"""Smoke test — every workflow script must import and expose _main()."""
from __future__ import annotations

import importlib
import inspect

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
    assert hasattr(module, "_main"), f"{name} must expose _main()"
    assert callable(module._main), f"{name}._main must be callable"
    assert len(inspect.signature(module._main).parameters) >= 0


def test_app_lists_all_workflow_scripts() -> None:
    app = importlib.import_module("app")
    names = [entry[0] for entry in app.WORKFLOW]
    for script in ["create_mission.py", "start_run.py", "plan_steps.py", "execute.py", "audit.py"]:
        assert script in names


def test_app_main_runs_without_side_effects() -> None:
    app = importlib.import_module("app")
    assert app._main(["--list"]) == 0
