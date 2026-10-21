"""Smoke test \u2014 verifies every workflow script imports and exposes _main().

Run with: python -m pytest smoke_test.py -v
"""
from __future__ import annotations

import importlib

import pytest

MODULES = [
    "create_templates",
    "create_group",
    "wire_assistant",
    "place_call",
    "scorecard",
    "webhook_receiver",
]


@pytest.mark.parametrize("module_name", MODULES)
def test_module_imports_and_exposes_main(module_name: str) -> None:
    module = importlib.import_module(module_name)
    assert hasattr(module, "_main"), f"{module_name} does not expose _main()"
    assert callable(module._main), f"{module_name}._main is not callable"


def test_webhook_receiver_exposes_flask_app() -> None:
    module = importlib.import_module("webhook_receiver")
    assert hasattr(module, "app"), "webhook_receiver does not expose the Flask app"
    routes = {rule.rule for rule in module.app.url_map.iter_rules()}
    assert "/webhooks/telnyx" in routes, "webhook route /webhooks/telnyx is not registered"


def test_scorecard_exposes_schemas() -> None:
    module = importlib.import_module("scorecard")
    assert set(module.SCHEMAS) == {"sentiment-v1", "compliance-v1", "escalation-v1"}
    for name, schema in module.SCHEMAS.items():
        assert schema["required"], f"{name} has no required fields"
        assert schema["enums"], f"{name} has no enums"


def test_create_templates_declares_three_templates() -> None:
    module = importlib.import_module("create_templates")
    names = [tpl["name"] for tpl in module.TEMPLATES]
    assert names == ["sentiment-v1", "compliance-v1", "escalation-v1"]


def test_webhook_verification_call_shape() -> None:
    """Assert the SDK exposes the documented verification function."""
    import telnyx

    assert hasattr(telnyx, "Webhook"), "telnyx.Webhook is not exposed by the installed SDK"
    assert hasattr(
        telnyx.Webhook, "construct_event"
    ), "telnyx.Webhook.construct_event is not exposed by the installed SDK"


def test_webhook_receiver_import_is_side_effect_free() -> None:
    """Importing webhook_receiver must not sys.exit when TELNYX_PUBLIC_KEY is unset."""
    module = importlib.import_module("webhook_receiver")
    assert callable(module._public_key)
    # _public_key raises (not exits) when the key is unset.
    import os

    if not os.getenv("TELNYX_PUBLIC_KEY"):
        with pytest.raises(RuntimeError):
            module._public_key()
