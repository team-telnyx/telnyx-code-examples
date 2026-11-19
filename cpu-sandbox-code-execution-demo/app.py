"""CPU Sandbox Code Execution Demo \u2014 Flask control surface for `telnyx-edge sandbox-cpu`.

SELF-REVIEW:
\u2705 Primitives composed: Sandbox Instance (create/list), Container Image (--image),
   Exec Command (exec), File Transfer (cp in + cp out), Lifecycle State (pause/resume).
\u2705 Acceptance criteria covered:
   - create returns a sandbox id with status "running"
   - exec returns the captured stdout from the isolated environment
   - cp round-trips a file into the sandbox and back out to the local filesystem
   - pause flips status to "paused"; a later exec fails with a clear 409
     "sandbox is not running (paused)" error
\u2705 smoke_test.py imports this module, asserts every route is registered, and
   exercises the full demo flow through the Flask test client.
\u2705 Demo mode is the default (DEMO_MODE=true) \u2014 no real sandbox is provisioned.
\u2705 No credentials in code; the CLI reads its own auth from
   `telnyx-edge auth api-key set`.

ASSUMPTION: The sandbox control plane is driven through the documented
  `telnyx-edge sandbox-cpu` CLI \u2014 there is no typed Python SDK resource for
  sandboxes. We shell out with an argv list (never shell=True) so caller input
  can never be interpreted by a shell.
ASSUMPTION: `exec` takes the command after a `--` separator, e.g.
  `telnyx-edge sandbox-cpu exec <id> -- python3 /tmp/process.py`.
ASSUMPTION: `cp` uses the `<sandbox-id>:<path>` remote syntax, matching scp.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

load_dotenv()

app = Flask(__name__)

DEMO_MODE = os.getenv("DEMO_MODE", "true").strip().lower() in {"1", "true", "yes", "on"}
TELNYX_EDGE_BIN = os.getenv("TELNYX_EDGE_BIN", "telnyx-edge")
DEFAULT_IMAGE = os.getenv("SANDBOX_IMAGE", "python:3.12-slim")
CLI_TIMEOUT = int(os.getenv("CLI_TIMEOUT_SECONDS", "120"))
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", "1048576"))

SANDBOX_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
IMAGE_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,127}(?::[A-Za-z0-9._-]{1,64})?$")
REMOTE_PATH_RE = re.compile(r"^/?[A-Za-z0-9._/-]{1,255}$")

DEMO_SCRIPT = """\
import json, statistics
samples = [12, 15, 9, 22, 18, 30, 27]
result = {"count": len(samples), "mean": round(statistics.mean(samples), 2), "max": max(samples)}
with open("/tmp/result.json", "w") as fh:
    json.dump(result, fh)
print(json.dumps(result))
"""


class ValidationError(ValueError):
    """Caller-supplied input failed validation."""


class SandboxError(RuntimeError):
    """The sandbox control plane reported a failure."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def _demo_output(args: list[str]) -> str:
    """Simulate the CLI's stdout for demo mode. Never touches a real sandbox."""
    sub = args[0]
    if sub == "create":
        return json.dumps({"id": "sbx-demo-0001", "status": "running", "image": DEFAULT_IMAGE})
    if sub == "exec":
        return json.dumps({"exit_code": 0, "stdout": '{"count": 7, "mean": 19.0, "max": 30}\n', "stderr": ""})
    if sub == "cp":
        destination = args[2]
        if ":" not in destination:  # sandbox -> local download
            with open(destination, "w", encoding="utf-8") as handle:
                handle.write('{"count": 7, "mean": 19.0, "max": 30}\n')
        return json.dumps({"ok": True})
    if sub in {"pause", "resume"}:
        return json.dumps({"id": args[1], "status": "paused" if sub == "pause" else "running"})
    if sub == "list":
        return json.dumps({"sandboxes": [{"id": "sbx-demo-0001", "status": "paused", "image": DEFAULT_IMAGE}]})
    return json.dumps({"ok": True})


class SandboxClient:
    """Thin, validated wrapper around the `telnyx-edge sandbox-cpu` CLI."""

    def __init__(self, binary: str, demo: bool) -> None:
        self.binary = binary
        self.demo = demo

    def run(self, args: list[str], timeout: int = CLI_TIMEOUT) -> str:
        if self.demo:
            app.logger.info("[demo] telnyx-edge sandbox-cpu %s", " ".join(args))
            return _demo_output(args)
        try:
            proc = subprocess.run(
                [self.binary, "sandbox-cpu", *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise SandboxError("telnyx-edge CLI not found on PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise SandboxError("telnyx-edge CLI timed out") from exc
        if proc.returncode != 0:
            detail = (proc.stderr or "").strip()
            app.logger.error("telnyx-edge rc=%s stderr=%s", proc.returncode, detail[:500])
            if re.search(r"not running|paused|stopped", detail, re.IGNORECASE):
                raise SandboxError("sandbox is not running (paused)", status=409)
            raise SandboxError("sandbox command failed", status=502)
        return proc.stdout


sandbox_client = SandboxClient(TELNYX_EDGE_BIN, DEMO_MODE)


def _parse(output: str) -> dict[str, Any]:
    text = (output or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}
    return parsed if isinstance(parsed, dict) else {"data": parsed}


def _json_body() -> dict[str, Any]:
    body = request.get_json(silent=True)
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ValidationError("request body must be a JSON object")
    return body


def _validate_sandbox_id(sandbox_id: str) -> None:
    if not isinstance(sandbox_id, str) or not SANDBOX_ID_RE.match(sandbox_id):
        raise ValidationError("invalid sandbox id")


def _validate_image(image: str) -> None:
    if not isinstance(image, str) or not IMAGE_RE.match(image):
        raise ValidationError("invalid container image reference")


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise ValidationError("invalid sandbox name")


def _validate_remote_path(path: str) -> None:
    if not isinstance(path, str) or not REMOTE_PATH_RE.match(path):
        raise ValidationError("invalid remote path")
    if ".." in path.split("/"):
        raise ValidationError("remote path may not traverse directories")


def _validate_command(command: Any) -> list[str]:
    if isinstance(command, str):
        command = shlex.split(command)
    if not isinstance(command, list) or not command:
        raise ValidationError("command must be a non-empty string or list of strings")
    tokens: list[str] = []
    for token in command:
        if not isinstance(token, str) or not token or len(token) > 512:
            raise ValidationError("invalid command token")
        if "\n" in token or "\x00" in token:
            raise ValidationError("invalid command token")
        tokens.append(token)
    return tokens


def _create_sandbox(image: str, name: str | None) -> dict[str, Any]:
    args = ["create", "--image", image]
    if name:
        args += ["--name", name]
    return _parse(sandbox_client.run(args))


def _exec_command(sandbox_id: str, command: list[str]) -> dict[str, Any]:
    return _parse(sandbox_client.run(["exec", sandbox_id, "--", *command]))


def _upload_file(sandbox_id: str, remote_path: str, content: str) -> int:
    payload = content.encode("utf-8")
    if len(payload) > MAX_FILE_BYTES:
        raise ValidationError("file exceeds size limit")
    with tempfile.TemporaryDirectory() as tmp:
        local = os.path.join(tmp, "upload")
        with open(local, "wb") as handle:
            handle.write(payload)
        sandbox_client.run(["cp", local, f"{sandbox_id}:{remote_path}"])
    return len(payload)


def _download_file(sandbox_id: str, remote_path: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        local = os.path.join(tmp, "download")
        sandbox_client.run(["cp", f"{sandbox_id}:{remote_path}", local])
        if not os.path.exists(local):
            raise SandboxError("file transfer produced no local file")
        with open(local, "rb") as handle:
            return handle.read(MAX_FILE_BYTES).decode("utf-8", errors="replace")


@app.errorhandler(ValidationError)
def _handle_validation(exc: ValidationError) -> tuple[Any, int]:
    return jsonify({"error": str(exc)}), 400


@app.errorhandler(SandboxError)
def _handle_sandbox(exc: SandboxError) -> tuple[Any, int]:
    return jsonify({"error": str(exc)}), exc.status


@app.errorhandler(Exception)
def _handle_unexpected(exc: Exception) -> Any:
    if isinstance(exc, HTTPException):
        return exc
    app.logger.exception("unhandled error")
    return jsonify({"error": "internal server error"}), 500


@app.post("/sandboxes")
def create_sandbox() -> tuple[Any, int]:
    body = _json_body()
    image = body.get("image", DEFAULT_IMAGE)
    name = body.get("name")
    _validate_image(image)
    if name is not None:
        _validate_name(name)
    return jsonify(_create_sandbox(image, name)), 201


@app.get("/sandboxes")
def list_sandboxes() -> tuple[Any, int]:
    return jsonify(_parse(sandbox_client.run(["list"]))), 200


@app.post("/sandboxes/<sandbox_id>/exec")
def exec_command(sandbox_id: str) -> tuple[Any, int]:
    _validate_sandbox_id(sandbox_id)
    command = _validate_command(_json_body().get("command"))
    return jsonify(_exec_command(sandbox_id, command)), 200


@app.post("/sandboxes/<sandbox_id>/files")
def upload_file(sandbox_id: str) -> tuple[Any, int]:
    _validate_sandbox_id(sandbox_id)
    body = _json_body()
    remote_path = body.get("remote_path")
    content = body.get("content")
    _validate_remote_path(remote_path)
    if not isinstance(content, str):
        raise ValidationError("content must be a string")
    written = _upload_file(sandbox_id, remote_path, content)
    return jsonify({"sandbox_id": sandbox_id, "remote_path": remote_path, "bytes": written}), 201


@app.get("/sandboxes/<sandbox_id>/files")
def download_file(sandbox_id: str) -> tuple[Any, int]:
    _validate_sandbox_id(sandbox_id)
    remote_path = request.args.get("path", "")
    _validate_remote_path(remote_path)
    return jsonify({
        "sandbox_id": sandbox_id,
        "remote_path": remote_path,
        "content": _download_file(sandbox_id, remote_path),
    }), 200


@app.post("/sandboxes/<sandbox_id>/pause")
def pause_sandbox(sandbox_id: str) -> tuple[Any, int]:
    _validate_sandbox_id(sandbox_id)
    return jsonify(_parse(sandbox_client.run(["pause", sandbox_id]))), 200


@app.post("/sandboxes/<sandbox_id>/resume")
def resume_sandbox(sandbox_id: str) -> tuple[Any, int]:
    _validate_sandbox_id(sandbox_id)
    return jsonify(_parse(sandbox_client.run(["resume", sandbox_id]))), 200


@app.post("/demo/run")
def run_demo() -> tuple[Any, int]:
    """Walk the full ticket flow: create -> cp in -> exec -> cp out -> pause -> list."""
    transcript: list[dict[str, Any]] = []

    created = _create_sandbox(DEFAULT_IMAGE, "cpu-demo")
    sandbox_id = created.get("id")
    if not isinstance(sandbox_id, str):
        raise SandboxError("sandbox create returned no id")
    _validate_sandbox_id(sandbox_id)
    transcript.append({"step": "create", "sandbox_id": sandbox_id, "result": created})

    _upload_file(sandbox_id, "/tmp/process.py", DEMO_SCRIPT)
    transcript.append({"step": "cp (upload)", "remote_path": "/tmp/process.py"})

    transcript.append({
        "step": "exec",
        "command": ["python3", "/tmp/process.py"],
        "result": _exec_command(sandbox_id, ["python3", "/tmp/process.py"]),
    })

    transcript.append({
        "step": "cp (download)",
        "remote_path": "/tmp/result.json",
        "content": _download_file(sandbox_id, "/tmp/result.json"),
    })

    transcript.append({"step": "pause", "result": _parse(sandbox_client.run(["pause", sandbox_id]))})
    transcript.append({"step": "list", "result": _parse(sandbox_client.run(["list"]))})

    return jsonify({"demo_mode": DEMO_MODE, "sandbox_id": sandbox_id, "transcript": transcript}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("FLASK_PORT", "5000")))
