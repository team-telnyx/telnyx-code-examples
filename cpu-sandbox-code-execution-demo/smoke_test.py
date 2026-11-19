"""Smoke tests for the CPU Sandbox Code Execution Demo.

Run with: python -m pytest smoke_test.py -v
No network access, no telnyx-edge CLI, and no real sandbox are required \u2014
DEMO_MODE defaults to true so every control-plane call is simulated.
"""

import os

os.environ.setdefault("DEMO_MODE", "true")

import app as app_module  # noqa: E402  (import after env setup on purpose)

SANDBOX_ID = "sbx-demo-0001"


def test_module_imports() -> None:
    assert app_module.app is not None
    assert app_module.sandbox_client is not None


def test_demo_mode_is_default() -> None:
    assert app_module.DEMO_MODE is True


def test_routes_registered() -> None:
    rules = {rule.rule for rule in app_module.app.url_map.iter_rules()}
    expected = {
        "/sandboxes",
        "/sandboxes/<sandbox_id>/exec",
        "/sandboxes/<sandbox_id>/files",
        "/sandboxes/<sandbox_id>/pause",
        "/sandboxes/<sandbox_id>/resume",
        "/demo/run",
    }
    assert expected.issubset(rules)


def test_create_sandbox_returns_running_id() -> None:
    client = app_module.app.test_client()
    resp = client.post("/sandboxes", json={"image": "python:3.12-slim", "name": "cpu-demo"})
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["id"]
    assert body["status"] == "running"


def test_exec_returns_stdout() -> None:
    client = app_module.app.test_client()
    resp = client.post(f"/sandboxes/{SANDBOX_ID}/exec", json={"command": ["python3", "-c", "print(1)"]})
    assert resp.status_code == 200
    assert "stdout" in resp.get_json()


def test_file_roundtrip() -> None:
    client = app_module.app.test_client()
    upload = client.post(
        f"/sandboxes/{SANDBOX_ID}/files",
        json={"remote_path": "/tmp/result.json", "content": '{"ok": true}'},
    )
    assert upload.status_code == 201
    assert upload.get_json()["bytes"] > 0

    download = client.get(f"/sandboxes/{SANDBOX_ID}/files", query_string={"path": "/tmp/result.json"})
    assert download.status_code == 200
    assert download.get_json()["content"]


def test_pause_changes_status_and_list_reflects_it() -> None:
    client = app_module.app.test_client()
    paused = client.post(f"/sandboxes/{SANDBOX_ID}/pause")
    assert paused.status_code == 200
    assert paused.get_json()["status"] == "paused"

    listed = client.get("/sandboxes")
    assert listed.status_code == 200
    assert listed.get_json()["sandboxes"][0]["status"] == "paused"


def test_resume_changes_status_back() -> None:
    client = app_module.app.test_client()
    resumed = client.post(f"/sandboxes/{SANDBOX_ID}/resume")
    assert resumed.status_code == 200
    assert resumed.get_json()["status"] == "running"


def test_invalid_image_rejected() -> None:
    client = app_module.app.test_client()
    resp = client.post("/sandboxes", json={"image": "bad image; rm -rf /"})
    assert resp.status_code == 400


def test_invalid_sandbox_id_rejected() -> None:
    client = app_module.app.test_client()
    resp = client.post("/sandboxes/bad$id/exec", json={"command": ["ls"]})
    assert resp.status_code == 400


def test_path_traversal_rejected() -> None:
    client = app_module.app.test_client()
    resp = client.get(f"/sandboxes/{SANDBOX_ID}/files", query_string={"path": "../../etc/passwd"})
    assert resp.status_code == 400


def test_empty_command_rejected() -> None:
    client = app_module.app.test_client()
    resp = client.post(f"/sandboxes/{SANDBOX_ID}/exec", json={"command": []})
    assert resp.status_code == 400


def test_demo_flow_end_to_end() -> None:
    client = app_module.app.test_client()
    resp = client.post("/demo/run")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["sandbox_id"]
    steps = [entry["step"] for entry in body["transcript"]]
    assert steps == ["create", "cp (upload)", "exec", "cp (download)", "pause", "list"]
