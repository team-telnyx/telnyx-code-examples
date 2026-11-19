# API Reference — CPU Sandbox Code Execution Demo

Typed HTTP contract for the Flask control surface that wraps the `telnyx-edge sandbox-cpu` CLI. Every route below is registered in `app.py`; nothing else is exposed.

- **Base URL (local):** `http://localhost:5000`
- **Content type:** `application/json` for all request bodies and responses
- **Auth:** none at the HTTP layer. The CLI authenticates itself via `telnyx-edge auth api-key set <KEY>` (or `TELNYX_API_KEY` in the environment). The Flask app never sees or forwards credentials.
- **Demo mode:** when `DEMO_MODE=true` (default) the CLI is never invoked; responses are synthesized by `_demo_output()` and match the shapes documented here.

---

## Error envelope

All application-level errors return a single-key JSON object:

```json
{ "error": "human readable message" }
```

| Source | Status | `error` value |
|---|---|---|
| `ValidationError` | `400` | `invalid sandbox id`, `invalid container image reference`, `invalid sandbox name`, `invalid remote path`, `remote path may not traverse directories`, `command must be a non-empty string or list of strings`, `invalid command token`, `content must be a string`, `file exceeds size limit`, `request body must be a JSON object` |
| `SandboxError` (paused/stopped) | `409` | `sandbox is not running (paused)` |
| `SandboxError` (CLI failure) | `502` | `sandbox command failed`, `telnyx-edge CLI not found on PATH`, `telnyx-edge CLI timed out`, `sandbox create returned no id`, `file transfer produced no local file` |
| Unhandled exception | `500` | `internal server error` (details are logged via `app.logger.exception`, never returned) |

---

## POST /sandboxes

Create a CPU sandbox from a container image. Maps to `telnyx-edge sandbox-cpu create --image <image> [--name <name>]`.

### Request body

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `image` | string | No | `SANDBOX_IMAGE` env var (`python:3.12-slim`) | Container image reference. Must match `^[a-z0-9][a-z0-9._/-]{0,127}(?::[A-Za-z0-9._-]{1,64})?$` — lowercase repo path with optional `:tag`. |
| `name` | string | No | `null` | Optional sandbox name. Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

An empty body (`{}`) is valid and creates a sandbox from the default image.

### Example request

```bash
curl -s -X POST http://localhost:5000/sandboxes \
  -H 'Content-Type: application/json' \
  -d '{"image": "python:3.12-slim", "name": "cpu-demo"}'
```

### Response — `201 Created`

```json
{
  "id": "sbx-demo-0001",
  "status": "running",
  "image": "python:3.12-slim"
}
```

The body is the CLI's stdout parsed as JSON. If the CLI emits non-JSON text it is returned as `{"raw": "<stdout>"}`; a JSON array is wrapped as `{"data": [...]}`.

### Status codes

| Code | Meaning |
|---|---|
| `201` | Sandbox created; `status` is `running`. |
| `400` | `image` or `name` failed validation. |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero. |

---

## GET /sandboxes

List sandboxes and their lifecycle state. Maps to `telnyx-edge sandbox-cpu list`.

### Request body

None.

### Example request

```bash
curl -s http://localhost:5000/sandboxes
```

### Response — `200 OK`

```json
{
  "sandboxes": [
    { "id": "sbx-demo-0001", "status": "paused", "image": "python:3.12-slim" }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | List returned (may be empty). |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero. |

---

## POST /sandboxes/{sandbox_id}/exec

Execute a command inside the sandbox and capture stdout. Maps to `telnyx-edge sandbox-cpu exec <id> -- <command...>`.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sandbox_id` | string | Yes | Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | string \| string[] | Yes | Command to run. A string is split with `shlex.split`; a list is used verbatim as argv. Must be non-empty; each token must be a non-empty string ≤ 512 chars with no newline or NUL byte. |

### Example request

```bash
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/exec \
  -H 'Content-Type: application/json' \
  -d '{"command": ["python3", "/tmp/process.py"]}'
```

### Response — `200 OK`

```json
{
  "exit_code": 0,
  "stdout": "{\"count\": 7, \"mean\": 19.0, \"max\": 30}\n",
  "stderr": ""
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Command executed; stdout/stderr/exit code returned. |
| `400` | Invalid `sandbox_id` or `command`. |
| `409` | Sandbox is paused or stopped — `{"error": "sandbox is not running (paused)"}`. |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero for another reason. |

---

## POST /sandboxes/{sandbox_id}/files

Upload a text file into the sandbox. Maps to `telnyx-edge sandbox-cpu cp <local> <sandbox-id>:<remote-path>`. The payload is written to a temporary local file first, so the CLI always sees a real path.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sandbox_id` | string | Yes | Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `remote_path` | string | Yes | Destination path inside the sandbox. Must match `^/?[A-Za-z0-9._/-]{1,255}$` and must not contain a `..` segment. |
| `content` | string | Yes | UTF-8 file contents. Encoded size must not exceed `MAX_FILE_BYTES` (default `1048576`). |

### Example request

```bash
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/files \
  -H 'Content-Type: application/json' \
  -d '{
        "remote_path": "/tmp/process.py",
        "content": "import json\nprint(json.dumps({\"ok\": true}))\n"
      }'
```

### Response — `201 Created`

```json
{
  "sandbox_id": "sbx-demo-0001",
  "remote_path": "/tmp/process.py",
  "bytes": 42
}
```

`bytes` is the UTF-8 encoded length of `content`.

### Status codes

| Code | Meaning |
|---|---|
| `201` | File written into the sandbox filesystem. |
| `400` | Invalid `sandbox_id`, `remote_path`, non-string `content`, or size limit exceeded. |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero. |

---

## GET /sandboxes/{sandbox_id}/files

Download a file from the sandbox. Maps to `telnyx-edge sandbox-cpu cp <sandbox-id>:<remote-path> <local>`, then reads the local copy back.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sandbox_id` | string | Yes | Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

### Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | Remote path to fetch. Same pattern and traversal rules as `remote_path` above. |

### Example request

```bash
curl -s 'http://localhost:5000/sandboxes/sbx-demo-0001/files?path=/tmp/result.json'
```

### Response — `200 OK`

```json
{
  "sandbox_id": "sbx-demo-0001",
  "remote_path": "/tmp/result.json",
  "content": "{\"count\": 7, \"mean\": 19.0, \"max\": 30}\n"
}
```

`content` is decoded as UTF-8 with `errors="replace"` and truncated at `MAX_FILE_BYTES`.

### Status codes

| Code | Meaning |
|---|---|
| `200` | File retrieved and returned inline. |
| `400` | Invalid `sandbox_id` or `path` (including a missing `path`). |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, exited non-zero, or produced no local file. |

---

## POST /sandboxes/{sandbox_id}/pause

Pause a running sandbox, preserving its filesystem and state. Maps to `telnyx-edge sandbox-cpu pause <id>`.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sandbox_id` | string | Yes | Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

### Request body

None.

### Example request

```bash
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/pause
```

### Response — `200 OK`

```json
{ "id": "sbx-demo-0001", "status": "paused" }
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Sandbox status is now `paused`. |
| `400` | Invalid `sandbox_id`. |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero. |

---

## POST /sandboxes/{sandbox_id}/resume

Resume a paused sandbox. Maps to `telnyx-edge sandbox-cpu resume <id>`.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sandbox_id` | string | Yes | Must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |

### Request body

None.

### Example request

```bash
curl -s -X POST http://localhost:5000/sandboxes/sbx-demo-0001/resume
```

### Response — `200 OK`

```json
{ "id": "sbx-demo-0001", "status": "running" }
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Sandbox status is now `running`. |
| `400` | Invalid `sandbox_id`. |
| `500` | Unexpected server error. |
| `502` | CLI missing, timed out, or exited non-zero. |

---

## POST /demo/run

Walk the entire ticket flow in one call: **create → cp (upload) → exec → cp (download) → pause → list**. Uses the built-in `DEMO_SCRIPT` (a small `statistics` computation writing `/tmp/result.json`) and the default image.

### Request body

None.

### Example request

```bash
curl -s -X POST http://localhost:5000/demo/run
```

### Response — `200 OK`

```json
{
  "demo_mode": true,
  "sandbox_id": "sbx-demo-0001",
  "transcript": [
    { "step": "create", "sandbox_id": "sbx-demo-0001", "result": { "id": "sbx-demo-0001", "status": "running", "image": "python:3.12-slim" } },
    { "step": "cp (upload)", "remote_path": "/tmp/process.py" },
    { "step": "exec", "command": ["python3", "/tmp/process.py"], "result": { "exit_code": 0, "stdout": "{\"count\": 7, \"mean\": 19.0, \"max\": 30}\n", "stderr": "" } },
    { "step": "cp (download)", "remote_path": "/tmp/result.json", "content": "{\"count\": 7, \"mean\": 19.0, \"max\": 30}\n" },
    { "step": "pause", "result": { "id": "sbx-demo-0001", "status": "paused" } },
    { "step": "list", "result": { "sandboxes": [ { "id": "sbx-demo-0001", "status": "paused", "image": "python:3.12-slim" } ] } }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Full transcript returned. |
| `500` | Unexpected server error. |
| `502` | Any step failed — CLI missing/timed out, create returned no `id`, or a transfer produced no file. |

---

## Status code summary

| Code | When it occurs |
|---|---|
| `200` | Successful read/exec/pause/resume/demo run. |
| `201` | Sandbox created (`POST /sandboxes`) or file uploaded (`POST /sandboxes/{id}/files`). |
| `400` | Any `ValidationError` — bad sandbox id, image, name, remote path, command, content, or non-object JSON body. |
| `404` | No route matches the method + path. Served by Flask's default handler (HTML body, not the JSON error envelope). |
| `409` | `exec` against a paused/stopped sandbox — `{"error": "sandbox is not running (paused)"}`. |
| `500` | Unhandled exception — generic `{"error": "internal server error"}`; details only in server logs. |
| `502` | `SandboxError` from the CLI — binary not on `PATH`, timeout, non-zero exit, or a malformed CLI result. |

---

## Environment variables affecting the contract

| Variable | Default | Effect on API behavior |
|---|---|---|
| `DEMO_MODE` | `true` | When true, no CLI process is spawned; responses come from the in-process simulator. |
| `TELNYX_EDGE_BIN` | `telnyx-edge` | Binary invoked for every live-mode call. |
| `SANDBOX_IMAGE` | `python:3.12-slim` | Default `image` for `POST /sandboxes` and the image used by `POST /demo/run`. |
| `CLI_TIMEOUT_SECONDS` | `120` | Per-command subprocess timeout; exceeding it yields `502`. |
| `MAX_FILE_BYTES` | `1048576` | Upload size ceiling (`400`) and download truncation length. |
| `FLASK_PORT` | `5000` | Port the app binds to when run as `python app.py`. |
| `TELNYX_API_KEY` | — | Read by the `telnyx-edge` CLI itself, not by Flask. |
