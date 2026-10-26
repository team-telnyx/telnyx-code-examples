"""Smoke test: verifies app.py imports and exposes the expected routes."""

import os

os.environ.setdefault("DEMO_MODE", "true")

import app as app_module  # noqa: E402


def test_module_loads() -> None:
    assert app_module.app is not None


def test_routes_registered() -> None:
    rules = {rule.rule for rule in app_module.app.url_map.iter_rules()}
    assert "/health" in rules
    assert "/run" in rules


def test_flow_functions_exist() -> None:
    for name in (
        "purchase_dedicated_ip",
        "start_warmup",
        "create_default_pool",
        "add_ip_to_pool",
        "wait_for_send_ready",
        "send_test_email",
        "run_provisioning_flow",
    ):
        assert callable(getattr(app_module, name)), f"missing {name}"


def test_demo_mode_default() -> None:
    assert app_module.DEMO_MODE is True


def test_health_endpoint() -> None:
    client = app_module.app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_run_endpoint_demo_mode() -> None:
    client = app_module.app.test_client()
    resp = client.post("/run")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["demo_mode"] is True
    assert body["dedicated_ip"]["status"] == "provisioning"
    assert body["pool"]["is_default"] is True
    assert body["email"]["status"] == "queued"
