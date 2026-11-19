# CPU Sandbox Code Execution Demo — Guide

This guide walks through `cpu-sandbox-code-execution-demo`, a small Flask control surface that drives the `telnyx-edge sandbox-cpu` CLI. It provisions a CPU sandbox from a standard Linux image, uploads a Python script into it, executes that script, pulls the generated result file back out, and finally pauses the sandbox to demonstrate that state persists across lifecycle transitions.

The point of the demo is to show what a *sandbox* gives you that an ephemeral function does not: a real, isolated Linux filesystem that survives between commands, so multi-step workflows (upload → run → collect artifacts → pause → resume) actually work.

---

## What you'll build

A Flask app exposing seven routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sandboxes` | Create a CPU sandbox from a container image |
| `GET` | `/sandboxes` | List sandboxes and their lifecycle state |
| `POST` | `/sandboxes/<id>/exec` | Run a command inside the sandbox |
| `POST` | `/sandboxes/<id>/files` | Upload a file into the sandbox (`cp` in) |
| `GET` | `/sandboxes/<id>/files?path=...` | Download a file out of the sandbox (`cp` out) |
| `POST` | `/sandboxes/<id>/pause` | Pause the sandbox |
| `POST` | `/sandboxes/<id>/resume` | Resume a paused sandbox |
| `POST` | `/demo/run` | Execute the entire ticket flow end-to-end in one call |

Every route is a thin, validated wrapper around one `telnyx-edge sandbox-cpu` subcommand.

---

## Prerequisites

- **Python 3.10+** (the code uses `from __future__ import annotations` and modern type hints).
- **The `telnyx-edge` CLI, v0.6.0 or newer**, on your `PATH`. Install it and confirm with:
  ```bash
  telnyx-edge --version
  ```
- **A Telnyx API key.** The Flask app never reads the key itself — the CLI stores its own credentials. Authenticate once:
  ```bash
  telnyx-edge auth api-key set "$TELNYX_API_KEY"
  ```
- **Docker-style image access** for whatever `SANDBOX_IMAGE` you choose. The default is `python:3.12-slim`, which is what the demo script needs.

---

## 1. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Create your `.env`

```bash
cp .env.example .env
```

Then edit `.env`. Every variable the app reads is listed below.

| Variable | Default | What it does |
| --- | --- | --- |
| `DEMO_MODE` | `true` | When true, no real sandbox is provisioned — the CLI layer returns canned responses. Set to `false` for live mode. |
| `TELNYX_EDGE_BIN` | `telnyx-edge` | Path or name of the CLI binary. Useful if you have a versioned build. |
| `SANDBOX_IMAGE` | `python:3.12-slim` | Container image used by `POST /sandboxes` and `/demo/run` when the caller doesn't supply one. |
| `CLI_TIMEOUT_SECONDS` | `120` | Hard timeout for any single CLI invocation. |
| `MAX_FILE_BYTES` | `1048576` | Upload/download size ceiling (1 MiB). |
| `FLASK_PORT` | `5000` | Port for the dev server. |
| `TELNYX_API_KEY` | — | Consumed by `telnyx-edge auth api-key set`, **not** by `app.py`. Never read into the Flask process. |

---

## 3. Demo mode vs. live mode

This is the most important switch in the sample.

**Demo mode (`DEMO_MODE=true`, the default)** — the `SandboxClient.run()` method short-circuits before it ever touches `subprocess`. It logs the command it *would* have run and returns a deterministic JSON payload from the internal `_demo_output()` helper. Nothing is provisioned, nothing is billed, and the whole flow is reproducible offline. This is what `smoke_test.py` exercises.

**Live mode (`DEMO_MODE=false`)** — `SandboxClient.run()` shells out to the real CLI:

```python
subprocess.run(
    [self.binary, "sandbox-cpu", *args],
    capture_output=True, text=True, timeout=timeout, check=False,
)
```

Note the argv list. There is no `shell=True` anywhere in the sample, so caller-supplied strings can never be interpreted by a shell. To flip modes, change one line in `.env`:

```bash
DEMO_MODE=false
```

…and make sure you've run `telnyx-edge auth api-key set` first. In live mode the demo will actually create a sandbox, so remember to pause or clean it up afterwards.

---

## 4. How `app.py` is organized

The file is deliberately sectioned by feature. Here's the map, in the order the sections appear:

1. **Configuration block** — reads `DEMO_MODE`, `TELNYX_EDGE_BIN`, `SANDBOX_IMAGE`, `CLI_TIMEOUT`, `MAX_FILE_BYTES` from the environment via `load_dotenv()`. Also defines the three validation regexes (`SANDBOX_ID_RE`, `NAME_RE`, `IMAGE_RE`, `REMOTE_PATH_RE`) and the `DEMO_SCRIPT` payload.
2. **Error types** — `ValidationError` (maps to HTTP 400) and `SandboxError` (carries its own status, defaulting to 502).
3. **`_demo_output()`** — the canned-response generator used only in demo mode.
4. **`SandboxClient`** — the single choke point for every CLI call. `run()` is the only place `subprocess` appears.
5. **Parsing and validation helpers** — `_parse()`, `_json_body()`, and the `_validate_*` family.
6. **Primitive wrappers** — `_create_sandbox()`, `_exec_command()`, `_upload_file()`, `_download_file()`. Each one maps to exactly one CLI subcommand.
7. **Error handlers** — three `@app.errorhandler` registrations.
8. **Routes** — the seven Flask views.
9. **`/demo/run`** — the orchestration endpoint that chains all five primitives.

---

## 5. Walkthrough: the five primitives

### Step 1 — Create the sandbox (Sandbox Instance + Container Image)

`POST /sandboxes` calls `_create_sandbox(image, name)`, which builds:

```python
["create", "--image", image]  # plus ["--name", name] when supplied
```

and hands it to `sandbox_client.run()`. The image reference is validated against `IMAGE_RE` before it ever reaches the CLI — lowercase registry/repo characters, optional `:tag`. The name, if present, is validated against `NAME_RE`.

The response is whatever JSON the CLI emits, parsed by `_parse()`. In demo mode that's:

```json
{"id": "sbx-demo-0001", "status": "running", "image": "python:3.12-slim"}
```

The route returns HTTP **201** with that body. This satisfies the first acceptance criterion: a valid sandbox ID and `status: "running"`.

### Step 2 — Upload the script (File Transfer, `cp` in)

`POST /sandboxes/<id>/files` takes `{"remote_path": "/tmp/process.py", "content": "..."}`. `_upload_file()`:

1. Encodes the content and rejects it if it exceeds `MAX_FILE_BYTES`.
2. Writes it to a file inside a `tempfile.TemporaryDirectory()` — the temp dir is cleaned up automatically when the `with` block exits.
3. Runs `cp <local> <sandbox-id>:<remote-path>`.

The `sandbox-id:path` remote syntax mirrors `scp`, which is exactly what the CLI expects. `_validate_remote_path()` rejects anything with a `..` segment, so a caller can't traverse out of the intended directory.

The route responds **201** with `{"sandbox_id", "remote_path", "bytes"}`.

### Step 3 — Execute the script (Exec Command)

`POST /sandboxes/<id>/exec` takes `{"command": "python3 /tmp/process.py"}` or the list form `{"command": ["python3", "/tmp/process.py"]}`. `_validate_command()` accepts either:

- A **string** is split with `shlex.split()` — quoted arguments survive intact.
- A **list** is used as-is.

Either way, every token is checked: non-empty, under 512 characters, no newlines, no NUL bytes. The resulting argv is passed to `_exec_command()`, which runs:

```python
["exec", sandbox_id, "--", *command]
```

The `--` separator is what tells the CLI that everything after it belongs to the sandboxed process, not to `telnyx-edge` itself.

The parsed result carries `exit_code`, `stdout`, and `stderr`. In demo mode the stdout is the JSON the demo script would have printed:

```json
{"count": 7, "mean": 19.0, "max": 30}
```

This is the second acceptance criterion: `exec` returns the captured stdout from the isolated environment.

### Step 4 — Download the result (File Transfer, `cp` out)

`GET /sandboxes/<id>/files?path=/tmp/result.json` calls `_download_file()`, which runs:

```python
["cp", f"{sandbox_id}:{remote_path}", local]
```

then reads the local file back (capped at `MAX_FILE_BYTES`, decoded with `errors="replace"` so binary junk can't crash the handler). If the CLI reported success but no local file appeared, it raises `SandboxError("file transfer produced no local file")` rather than returning an empty string — a silent empty response would be much harder to debug.

The route returns **200** with `{"sandbox_id", "remote_path", "content"}`. Together with Step 2, this is the third acceptance criterion: the file is present in the sandbox filesystem and retrievable locally.

### Step 5 — Pause and verify (Lifecycle State)

`POST /sandboxes/<id>/pause` runs `["pause", sandbox_id]` and returns the parsed status. `POST /sandboxes/<id>/resume` does the mirror image.

The interesting part is what happens *after* a pause. In live mode, a subsequent `exec` against a paused sandbox makes the CLI exit non-zero with a message containing "not running", "paused", or "stopped". `SandboxClient.run()` catches that:

```python
if re.search(r"not running|paused|stopped", detail, re.IGNORECASE):
    raise SandboxError("sandbox is not running (paused)", status=409)
```

The `SandboxError` handler turns that into an HTTP **409** with `{"error": "sandbox is not running (paused)"}`. That's the fourth acceptance criterion — a clear, actionable error rather than a generic 500.

`GET /sandboxes` runs `["list"]` and returns the CLI's sandbox inventory, which is how you confirm the status actually flipped to `paused`.

---

## 6. The orchestration endpoint: `POST /demo/run`

This is the one-call version of the whole ticket. It walks the flow in order and accumulates a `transcript` array so you can see each step's result:

1. `create` — provisions `SANDBOX_IMAGE` with the name `cpu-demo`, extracts and validates the returned `id`.
2. `cp (upload)` — pushes the built-in `DEMO_SCRIPT` to `/tmp/process.py`.
3. `exec` — runs `python3 /tmp/process.py`.
4. `cp (download)` — pulls `/tmp/result.json` back.
5. `pause` — flips the lifecycle state.
6. `list` — confirms the new state.

The response includes `demo_mode` so you always know whether you just touched a real sandbox:

```json
{
  "demo_mode": true,
  "sandbox_id": "sbx-demo-0001",
  "transcript": [ ... ]
}
```

The `DEMO_SCRIPT` itself is a tiny statistics job — it computes count/mean/max over a fixed sample list, writes the result to `/tmp/result.json`, and prints it. It's intentionally trivial: the point is the *plumbing*, not the computation.

---

## 7. Error handling

Three handlers are registered, in this order of specificity:

- **`ValidationError` → 400.** Raised by any `_validate_*` helper or by `_json_body()` when the payload isn't a JSON object. The message is safe to return verbatim because it's generated by our own code, never by the CLI.
- **`SandboxError` → its own `status`.** 409 for the paused-sandbox case, 502 for everything else (CLI missing, CLI timed out, CLI exited non-zero). The CLI's stderr is logged at error level but **never** returned to the caller — it can contain account identifiers.
- **`Exception` → 500.** `HTTPException` instances (404s, 405s) are re-raised untouched so Flask's normal behavior applies. Anything else is logged with `app.logger.exception()` and answered with a flat `{"error": "internal server error"}`.

---

## 8. Run it

```bash
python app.py
```

The server binds `0.0.0.0:$FLASK_PORT` (default 5000). Then, in another terminal:

**Run the whole flow at once:**

```bash
curl -s -X POST http://localhost:5000/demo/run | python -m json.tool
```

**Or drive it step by step:**

```bash
# 1. create
curl -s -X POST http://localhost:5000/sandboxes \
  -H 'Content-Type: application/json' \
  -d '{"image": "python:3.12-slim", "name": "my-demo"}'

# 2. upload
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/files \
  -H 'Content-Type: application/json' \
  -d '{"remote_path": "/tmp/process.py", "content": "print(1+1)"}'

# 3. exec
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/exec \
  -H 'Content-Type: application/json' \
  -d '{"command": ["python3", "/tmp/process.py"]}'

# 4. download
curl -s 'http://localhost:5000/sandboxes/sbx-demo-0001/files?path=/tmp/result.json'

# 5. pause, then confirm
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/pause
curl -s http://localhost:5000/sandboxes
```

**Verify the sample loads without a live sandbox:**

```bash
python smoke_test.py
```

The smoke test imports `app`, asserts every route is registered, and drives the full demo flow through Flask's test client — all in demo mode, so it needs no credentials and no network.

---

## 9. Acceptance criteria, mapped

| Criterion | Where it's implemented |
| --- | --- |
| `create` returns a valid sandbox ID with status `running` | `_create_sandbox()` + `POST /sandboxes` (201) |
| `exec` returns the expected stdout from the isolated environment | `_exec_command()` + `POST /sandboxes/<id>/exec` |
| `cp` round-trips a file in and back out | `_upload_file()` / `_download_file()` + the two `/files` routes |
| `pause` flips status to `paused`; later `exec` fails with a clear error | `POST /sandboxes/<id>/pause`, plus the 409 branch in `SandboxClient.run()` |

---

## 10. Security notes

- **No credentials in code.** The Flask process never reads `TELNYX_API_KEY`; the CLI owns its own auth store.
- **No shell.** Every CLI call is an argv list passed to `subprocess.run` with `check=False` and an explicit timeout. `shell=True` appears nowhere.
- **Input is validated before it reaches the CLI.** Sandbox IDs, names, image references, remote paths, and command tokens all have anchored regexes or explicit checks. Remote paths reject `..` traversal.
- **Size ceilings.** Uploads and downloads are both capped at `MAX_FILE_BYTES`.
- **Errors don't leak.** CLI stderr goes to the log, not the HTTP response.
- **Demo mode is the default.** You have to opt in to touching real infrastructure.

---

## Next steps

- **Sandbox reference docs** — the full `sandbox-cpu` command surface, image requirements, and lifecycle semantics: <https://developers.telnyx.com/docs/edge-compute/sandboxes>
- **CLI release notes (v0.6.0)** — the version this sample targets, including the `exec --` separator and `cp` remote-path syntax: <https://github.com/team-telnyx/edge-compute/releases/tag/v0.6.0>
- **Try it live.** Set `DEMO_MODE=false`, authenticate the CLI, and run `POST /demo/run`. Then `exec` against the paused sandbox to see the 409 in action.
- **Extend it.** The `SandboxClient` wrapper is the only place that knows about the CLI — swap in a different subcommand and the rest of the app keeps working. Natural additions: a `/sandboxes/<id>/resume` round-trip test, streaming large artifacts instead of buffering them, or a background sweeper that pauses sandboxes idle for more than N minutes.
- **Compare with ephemeral functions.** The reason this sample exists is the pause/resume pair — if your workload doesn't need filesystem state between invocations, a stateless function is the cheaper primitive.
