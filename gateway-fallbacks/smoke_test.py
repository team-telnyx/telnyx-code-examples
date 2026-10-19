"""Smoke test: verify app.py imports, Flask routes, secret non-leak, streaming
header capture, auth enforcement, and demo-mode network isolation. Runs without
a live server or real credentials."""

import importlib
import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("TELNYX_API_KEY", "test_key_placeholder")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("DEMO_AUTH_TOKEN", "test-auth-token")

AUTH = {"X-Demo-Auth": "test-auth-token"}


def _mod():
    return importlib.import_module("app")


def test_module_imports():
    mod = _mod()
    assert mod is not None
    assert hasattr(mod, "app")


def test_flask_app_exists():
    mod = _mod()
    assert mod.app is not None


def test_expected_routes_registered():
    mod = _mod()
    rules = {r.rule for r in mod.app.url_map.iter_rules()}
    for path in ["/health", "/provision", "/inference", "/ledger", "/policy", "/teardown"]:
        assert path in rules, f"missing route {path}"


def test_policy_validation_rejects_bad_config():
    mod = _mod()
    try:
        mod.validate_policy(
            ["a", "b", "c", "d", "e"],
            {"a": ["b", "c", "d", "e"]},
            {"max_attempts": 1},
        )
        assert False, "expected ValueError for chain depth"
    except ValueError:
        pass
    try:
        mod.validate_policy(["a", "b"], {"a": ["b"]}, {"max_attempts": 9})
        assert False, "expected ValueError for max_attempts"
    except ValueError:
        pass


def test_policy_validation_accepts_good_config():
    mod = _mod()
    mod.validate_policy(
        ["Kimi-K3", "GLM-5.3-Flash"],
        {"Kimi-K3": ["GLM-5.3-Flash"]},
        {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"},
    )


def test_health_endpoint():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "ok"
    assert "demo_mode" in body


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------
def test_mutating_routes_require_auth():
    mod = _mod()
    client = mod.app.test_client()
    assert client.post("/provision").status_code == 401
    assert client.post("/inference", json={"token_key": "tk"}).status_code == 401
    assert client.post("/policy", json={"token_key": "tk"}).status_code == 401
    assert client.post("/teardown", json={}).status_code == 401
    assert client.get("/ledger?token_key_id=k1&start_date=2026-01-01&end_date=2026-01-02").status_code == 401


def test_mutating_routes_reject_wrong_auth():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.post("/provision", headers={"X-Demo-Auth": "wrong"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Demo-mode network isolation
# ---------------------------------------------------------------------------
def test_demo_mode_provision_does_not_touch_network():
    mod = _mod()
    with patch.object(mod.requests, "request") as req, \
         patch.object(mod, "_openai_client") as oai:
        client = mod.app.test_client()
        resp = client.post("/provision", headers=AUTH)
        assert resp.status_code == 200
        assert req.call_count == 0
        assert oai.call_count == 0


def test_demo_mode_inference_does_not_touch_network():
    mod = _mod()
    with patch.object(mod.requests, "request") as req, \
         patch.object(mod, "_openai_client") as oai:
        client = mod.app.test_client()
        resp = client.post("/inference", headers=AUTH, json={"token_key": "tk_demo"})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["forced_failure"]["ok"] is True
        assert req.call_count == 0
        assert oai.call_count == 0


def test_demo_mode_policy_does_not_touch_network():
    mod = _mod()
    with patch.object(mod.requests, "request") as req, \
         patch.object(mod, "_openai_client") as oai:
        client = mod.app.test_client()
        resp = client.post("/policy", headers=AUTH, json={"token_key": "tk_demo"})
        assert resp.status_code == 200
        assert req.call_count == 0
        assert oai.call_count == 0


def test_demo_mode_teardown_does_not_touch_network():
    mod = _mod()
    with patch.object(mod.requests, "request") as req, \
         patch.object(mod, "_openai_client") as oai:
        client = mod.app.test_client()
        resp = client.post("/teardown", headers=AUTH, json={
            "key_id": "key_demo_0001",
            "key_etag": '"abc"',
            "group_id": "grp_demo_0001",
            "group_etag": '"def"',
        })
        assert resp.status_code == 200
        assert req.call_count == 0
        assert oai.call_count == 0


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
def test_inference_requires_token_key():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.post("/inference", headers=AUTH, json={})
    assert resp.status_code == 400


def test_inference_rejects_non_string_token_key():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.post("/inference", headers=AUTH, json={"token_key": 12345})
    assert resp.status_code == 400


def test_ledger_requires_params():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.get("/ledger", headers=AUTH)
    assert resp.status_code == 400


def test_ledger_rejects_bad_date_format():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.get(
        "/ledger?token_key_id=k1&start_date=not-a-date&end_date=2026-01-02",
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_ledger_rejects_unsafe_token_key_id():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.get(
        "/ledger?token_key_id=../../etc/passwd&start_date=2026-01-01&end_date=2026-01-02",
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_teardown_requires_params():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.post("/teardown", headers=AUTH, json={})
    assert resp.status_code == 400


def test_teardown_rejects_unsafe_identifiers():
    mod = _mod()
    client = mod.app.test_client()
    resp = client.post("/teardown", headers=AUTH, json={
        "key_id": "../evil",
        "key_etag": '"abc"',
        "group_id": "grp_1",
        "group_etag": '"def"',
    })
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Secret handling
# ---------------------------------------------------------------------------
def test_provision_response_does_not_leak_secret(tmp_path):
    """The token secret must never appear in the /provision HTTP body."""
    mod = _mod()
    fake_group = {"id": "grp_test"}
    fake_key = {"id": "key_test", "key": "SUPER_SECRET_VALUE"}
    secret_file = tmp_path / "secret.txt"
    with patch.object(mod, "DEMO_MODE", False), \
         patch.object(mod, "SECRET_FILE", secret_file), \
         patch.object(mod, "provision_group", return_value=fake_group), \
         patch.object(mod, "provision_key", return_value=fake_key):
        client = mod.app.test_client()
        resp = client.post("/provision", headers=AUTH)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body == {"group_id": "grp_test", "key_id": "key_test",
                        "secret_shown_once": True}
        assert "SUPER_SECRET_VALUE" not in resp.get_data(as_text=True)
    assert secret_file.read_text() == "SUPER_SECRET_VALUE"


# ---------------------------------------------------------------------------
# Header capture
# ---------------------------------------------------------------------------
def test_streaming_headers_captured_from_raw_response():
    """Streaming branch must read x-ltg-* headers off the raw response."""
    mod = _mod()

    fake_http_resp = MagicMock()
    fake_http_resp.headers = {
        "x-ltg-served-model": "GLM-5.3-Flash",
        "x-ltg-attempts": "2",
    }

    first_chunk = MagicMock()
    first_chunk.model = "GLM-5.3-Flash"

    fake_raw
