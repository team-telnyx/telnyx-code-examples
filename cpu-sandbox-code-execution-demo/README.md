---
name: cpu-sandbox-code-execution-demo
title: "CPU Sandbox Code Execution Demo — Isolated Python Execution with Persistent State"
description: "A Flask control surface that provisions a Telnyx Edge CPU sandbox, uploads and runs a Python script inside it, retrieves the result file, and pauses the sandbox to preserve state."
language: python
framework: flask
telnyx_products: [Edge Compute, Sandboxes]
---

# CPU Sandbox Code Execution Demo

A Flask control surface over `telnyx-edge sandbox-cpu` that creates an isolated Linux sandbox, runs untrusted Python inside it, round-trips files in and out, and pauses the sandbox so its state survives.

## The Story

A mid-sized regional bank runs a model-risk review desk. Every quarter, third-party vendors ship the desk Python pricing and stress-testing models that the bank is contractually allowed to execute but not to audit line by line — and if one of those models corrupts the review workstation, exfiltrates customer records, or silently produces a wrong capital number, the bank eats a regulatory finding, a restatement, and the trust of its depositors. The desk needs a place to run code it does not trust, on data it absolutely must protect, with results it can prove came from a clean run.

The actor IS the bank's model-risk review desk. It is born the moment an analyst requests a fresh sandbox from a pinned `python:3.12-slim` image — a clean, disposable Linux box with nothing on it but the interpreter. It evolves as the vendor's script is copied in, executed, and its `result.json` copied back out to the analyst's machine for the file to be signed off. It survives: when the analyst's laptop dies mid-review, or the control plane restarts between the exec and the download, the sandbox is paused rather than destroyed — the filesystem, the uploaded script, and the half-finished output are all still there when the desk resumes it the next morning, and a second `exec` against a paused sandbox fails loudly with a 409 instead of quietly returning stale numbers. It terminates only when the desk decides the review is closed. The rest of this README is the API surface of that story.

## Why Telnyx

Running untrusted code is the part of an AI product that everyone postpones until it becomes an incident. Telnyx Edge Compute gives you a first-class **sandbox primitive** — a real Linux container with a real filesystem, real lifecycle states, and real file transfer — sitting on the same **AI Communications Infrastructure** that carries your calls, messages, and agent traffic. That means the code your agents write can be executed somewhere that is isolated by construction, paused instead of lost, and audited through the same control plane as everything else you run. No bespoke Kubernetes, no shared jupyter host, no "we'll containerize it later."

## Telnyx API Endpoints Used

All sandbox operations go through the `telnyx-edge` CLI (`telnyx-edge sandbox-cpu ...`). There is no typed Python SDK resource for sandboxes, so this sample shells out with an argv list — never `shell=True`.

| CLI command | Purpose in this demo |
|---|---|
| `telnyx-edge sandbox-cpu create --image <ref> [--name <name>]` | Provision a CPU sandbox from a container image; returns `{id, status: "running", image}` |
| `telnyx-edge sandbox-cpu list` | List sandboxes and their lifecycle state |
| `telnyx-edge sandbox-cpu exec <id> -- <cmd...>` | Execute a command inside the sandbox and capture stdout/stderr/exit code |
| `telnyx-edge sandbox-cpu cp <local> <id>:<remote>` | Upload a file into the sandbox filesystem |
| `telnyx-edge sandbox-cpu cp <id>:<remote> <local>` | Download a file out of the sandbox |
| `telnyx-edge sandbox-cpu pause <id>` | Pause the sandbox, preserving its filesystem and state |
| `telnyx-edge sandbox-cpu resume <id>` | Resume a paused sandbox back to `running` |

The Flask app exposes these as HTTP routes (see [API Reference](#api-reference)).

## Architecture

```
┌──────────────────────────┐
│  Local CLI client        │
│  (curl / smoke_test.py)  │
└────────────┬─────────────┘
             │ HTTP (JSON)
             ▼
┌──────────────────────────────────────────────┐
│  Flask app (app.py)                          │
│  ├── input validation (id / image / path /   │
│  │   command token allow-lists)              │
│  ├── SandboxClient  ── argv, never shell=True│
│  └── demo mode shim (DEMO_MODE=true)         │
└────────────┬─────────────────────────────────┘
             │ subprocess: telnyx-edge sandbox-cpu ...
             ▼
┌──────────────────────────────────────────────┐
│  Telnyx Edge Compute — Control Plane         │
│  create · list · pause · resume              │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│  Data Plane — isolated Linux sandbox         │
│  image: python:3.12-slim                     │
│  ├── /tmp/process.py     (cp in)             │
│  ├── exec: python3 /tmp/process.py           │
│  └── /tmp/result.json    (cp out)            │
│  state: running ⇄ paused (filesystem kept)   │
└──────────────────────────────────────────────┘
```

Demo flow (`POST /demo/run`): **create** → **cp in** (`/tmp/process.py`) → **exec** (`python3 /tmp/process.py`) → **cp out** (`/tmp/result.json`) → **pause** → **list**.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CLI_TIMEOUT_SECONDS` | `string` | `your_cli_timeout_seconds_here` | **yes** | CLI_TIMEOUT_SECONDS | — |
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `FLASK_PORT` | `string` | `your_flask_port_here` | **yes** | FLASK_PORT | — |
| `MAX_FILE_BYTES` | `string` | `your_max_file_bytes_here` | **yes** | MAX_FILE_BYTES | — |
| `SANDBOX_IMAGE` | `string` | `your_sandbox_image_here` | **yes** | SANDBOX_IMAGE | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_EDGE_BIN` | `string` | `your_telnyx_edge_bin_here` | **yes** | TELNYX_EDGE_BIN | — |

Notes on the values:

- `DEMO_MODE` defaults to `true`. In demo mode **no real sandbox is provisioned** — every CLI call is answered by an in-process shim that logs the argv it would have run.
- `SANDBOX_IMAGE` defaults to `python:3.12-slim`.
- `CLI_TIMEOUT_SECONDS` defaults to `120`; `MAX_FILE_BYTES` defaults to `1048576` (1 MiB).
- `TELNYX_EDGE_BIN` defaults to `telnyx-edge` (resolved on `PATH`).
- `TELNYX_API_KEY` is only consumed by the CLI itself via `telnyx-edge auth api-key set` — the Flask app never reads or logs it.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/cpu-sandbox-code-execution-demo

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# edit .env if you want to change ports, image, or file limits
```

Run the app (demo mode is on by default — safe, no sandbox is created):

```bash
python app.py
# → http://127.0.0.1:5000
```

Walk the whole ticket flow in one call:

```bash
curl -s -X POST http://127.0.0.1:5000/demo/run | python -m json.tool
```

Run the smoke test (imports the module, asserts every route is registered, exercises the full flow through the Flask test client):

```bash
python smoke_test.py
```

### Switching to live mode

1. Install the Edge CLI and authenticate it:
   ```bash
   telnyx-edge auth api-key set "$TELNYX_API_KEY"
   ```
2. Set `DEMO_MODE=false` in `.env`.
3. Restart `python app.py`. Every route now shells out to the real `telnyx-edge sandbox-cpu` binary and provisions real sandboxes.

See `GUIDE.md` for the full demo-vs-live walkthrough.

## API Reference

| Method | Path | Body / Query | Success | Notes |
|---|---|---|---|---|
| `POST` | `/sandboxes` | `{"image"?: str, "name"?: str}` | `201` `{id, status, image}` | `image` defaults to `SANDBOX_IMAGE`; `status` is `running` |
| `GET` | `/sandboxes` | — | `200` `{sandboxes: [...]}` | Proxies `sandbox-cpu list` |
| `POST` | `/sandboxes/<id>/exec` | `{"command": str \| [str]}` | `200` `{exit_code, stdout, stderr}` | String commands are `shlex`-split; argv is passed after `--` |
| `POST` | `/sandboxes/<id>/files` | `{"remote_path": str, "content": str}` | `201` `{sandbox_id, remote_path, bytes}` | Upload via `cp`; capped at `MAX_FILE_BYTES` |
| `GET` | `/sandboxes/<id>/files?path=<remote>` | query `path` | `200` `{sandbox_id, remote_path, content}` | Download via `cp` |
| `POST` | `/sandboxes/<id>/pause` | — | `200` `{id, status: "paused"}` | Filesystem is preserved |
| `POST` | `/sandboxes/<id>/resume` | — | `200` `{id, status: "running"}` | |
| `POST` | `/demo/run` | — | `200` `{demo_mode, sandbox_id, transcript}` | Full create → cp in → exec → cp out → pause → list transcript |

Error responses:

| Status | Meaning |
|---|---|
| `400` | Validation failure — bad sandbox id, image reference, remote path, command token, or oversized file |
| `409` | `sandbox is not running (paused)` — an `exec` was attempted against a paused sandbox |
| `502` | The `telnyx-edge` CLI failed, timed out, or was not found on `PATH` |
| `500` | Unexpected internal error (details are logged, never returned) |

Example:

```bash
curl -s -X POST http://127.0.0.1:5000/sandboxes \
  -H 'Content-Type: application/json' \
  -d '{"image":"python:3.12-slim","name":"cpu-demo"}'

curl -s -X POST http://127.0.0.1:5000/sandboxes/sbx-demo-0001/exec \
  -H 'Content-Type: application/json' \
  -d '{"command":["python3","/tmp/process.py"]}'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `telnyx-edge CLI not found on PATH` (502) | CLI not installed, or `TELNYX_EDGE_BIN` points at the wrong path | Install the Edge CLI, or set `TELNYX_EDGE_BIN` to the absolute binary path |
| `sandbox is not running (paused)` (409) | You called `/exec` on a paused sandbox | `POST /sandboxes/<id>/resume` first — this is the intended behaviour, not a bug |
| `telnyx-edge CLI timed out` (502) | Long-running command exceeded `CLI_TIMEOUT_SECONDS` | Raise `CLI_TIMEOUT_SECONDS`, or move the work into a background script inside the sandbox |
| `invalid container image reference` (400) | Image string failed the allow-list regex | Use a lowercase `repo/name:tag` form, e.g. `python:3.12-slim` |
| `remote path may not traverse directories` (400) | Path contained a `..` segment | Use an absolute path inside the sandbox, e.g. `/tmp/result.json` |
| `file exceeds size limit` (400) | Upload larger than `MAX_FILE_BYTES` | Raise `MAX_FILE_BYTES` or chunk the upload |
| `file transfer produced no local file` (502) | `cp` reported success but nothing landed locally | Check the remote path exists — run `ls` via `/exec` first |
| Nothing happens / instant fake responses | `DEMO_MODE=true` | Set `DEMO_MODE=false` and authenticate the CLI for real sandboxes |

## Agent Discovery

- Agent signup and capability manifest: <https://telnyx.com/agent-signup.md>
- Telnyx AI agent tooling and examples: <https://github.com/team-telnyx/ai>
- Machine-readable docs index: <https://developers.telnyx.com/llms.txt>

## Related Examples

- **Edge Compute sandbox lifecycle** — create / pause / resume / list without the exec and file-transfer steps.
- **File transfer round-trip** — `cp` in both directions with size limits and path validation.
- **Untrusted code execution for AI agents** — wiring a sandbox behind an agent tool call so generated code runs isolated.
- **Telnyx Messaging + Edge** — notifying an operator when a sandbox run completes or fails.

## Resources

- Edge Compute sandboxes documentation: <https://developers.telnyx.com/docs/edge-compute/sandboxes>
- Telnyx API reference: <https://developers.telnyx.com/api>
- Telnyx Python SDK: <https://github.com/team-telnyx/telnyx-python>
- Edge Compute product page: <https://telnyx.com/products/edge-compute>
- Telnyx pricing: <https://telnyx.com/pricing>
- `telnyx-edge` CLI release notes (v0.6.0): <https://github.com/team-telnyx/edge-compute/releases/tag/v0.6.0>
