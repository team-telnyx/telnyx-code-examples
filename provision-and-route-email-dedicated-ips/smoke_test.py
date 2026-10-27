"""Smoke test: verifies app.py imports and exposes the expected routes."""

import os

os.environ.setdefault("DEMO_MODE", "true")

import app as app_module  # noqa: E402


def test_module_loads() -> None:
    if app_module.app is None:
        raise AssertionError("app module did not load a Flask application")


def test_routes_registered() -> None:
    rules = {rule.rule for rule in app_module.app.url_map.iter_rules()}
    if "/health" not in rules:
        raise AssertionError("expected /health route to be registered")
    if "/run" not in rules:
        raise AssertionError("expected /run route to be registered")


def test_flow_functions_exist() -> None:
    for name in (
        "purchase_dedicated_ip",
        "start_warmup",
        "create_default_pool",
        "find_default_pool",
        "resolve_default_pool",
        "add_ip_to_pool",
        "wait_for_send_ready",
        "list_email_domains",
        "preflight_email_setup",
        "send_test_email",
        "run_provisioning_flow",
    ):
        if not callable(getattr(app_module, name, None)):
            raise AssertionError(f"missing flow function: {name}")


def test_demo_mode_default() -> None:
    if app_module.DEMO_MODE is not True:
        raise AssertionError("DEMO_MODE must default to true")


def test_health_endpoint() -> None:
    client = app_module.app.test_client()
    resp = client.get("/health")
    if resp.status_code != 200:
        raise AssertionError(f"expected 200 on /health, got {resp.status_code}")
    if resp.get_json().get("status") != "ok":
        raise AssertionError("/health returned unexpected status body")


def test_run_endpoint_demo_mode() -> None:
    client = app_module.app.test_client()
    resp = client.post("/run")
    if resp.status_code != 200:
        raise AssertionError(f"expected 200 on /run, got {resp.status_code}")
    body = resp.get_json()
    if body.get("demo_mode") is not True:
        raise AssertionError("/run must report demo_mode true")
    if body.get("dedicated_ip", {}).get("status") != "provisioning":
        raise AssertionError("dedicated_ip.status must be 'provisioning' in demo output")
    if body.get("pool", {}).get("is_default") is not True:
        raise AssertionError("pool.is_default must be true in demo output")
    if body.get("email", {}).get("status") != "queued":
        raise AssertionError("email.status must be 'queued' in demo output")
