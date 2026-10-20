"""Smoke tests for the Scheduled-Events Retry Campaign Desk sample.

Verifies every workflow script loads without error and exposes its `_main()`
entry point, plus the pure helpers that encode the documented retry semantics.

Run with: python -m pytest smoke_test.py -v
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

WORKFLOW_MODULES = ["app", "create_campaign", "watch_campaign", "report", "teardown"]


@pytest.mark.parametrize("module_name", WORKFLOW_MODULES)
def test_module_loads_and_exposes_main(module_name: str) -> None:
    """Each workflow script must import cleanly and expose a callable _main()."""
    module = importlib.import_module(module_name)
    assert hasattr(module, "_main"), f"{module_name} is missing _main()"
    assert callable(module._main), f"{module_name}._main is not callable"


def test_app_dispatcher_lists_all_workflow_scripts() -> None:
    """app.py must advertise each workflow script."""
    app = importlib.import_module("app")
    scripts = {name for name, _ in app.WORKFLOW}
    assert scripts == {"create_campaign.py", "watch_campaign.py", "report.py", "teardown.py"}


def test_retry_budget_bounds_enforced() -> None:
    """create_campaign.validate_retry_budget must enforce the documented bounds."""
    cc = importlib.import_module("create_campaign")
    cc.validate_retry_budget(3, 300)  # valid
    with pytest.raises(ValueError):
        cc.validate_retry_budget(11, 300)  # max_retries out of range
