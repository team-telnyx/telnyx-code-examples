# API Reference — Missions Audit Desk

Typed contract for every Telnyx endpoint this sample calls. The AI Missions surface **and the AI Assistants surface** are **untyped in the shipped `telnyx` SDK**, so all routes are invoked as raw REST against `TELNYX_API_BASE` (default `https://api.telnyx.com/v2`) with `Authorization: Bearer $TELNYX_API_KEY` and `Content-Type: application/json`. Every response is unwrapped from the `{"data": ...}` envelope.

---

## Common conventions

| Item | Value |
|---|---|
| Base URL | `TELNYX_API_BASE` env, default `https://api.telnyx.com/v2` |
| Auth header | `Authorization: Bearer <TELNYX_API_KEY>` |
| Content type | `application/json` |
| Response envelope | `{"data": <object or array>}` |
| Error envelope | `{"errors": [{"code": "...", "title": "...", "detail": "..."}]}` |

### Enums

**`RunStatus`** — `pending` | `running` | `paused` | `succeeded` | `failed` | `cancelled`

**Step status** — `pending` | `in_progress` | `completed` | `skipped` | `failed`

**`EventType`** — `status_change` | `step_started` | `step_completed` | `step_failed` | `tool_call` | `tool_result` | `message` | `error` | `custom`

**`EventStatus`** (scheduled events) — `pending` | `in_progress` | `completed` | `failed`

---

## `POST /ai/missions`

Create a mission — the durable objective that persists across runs.

**Source:** `create_mission.py` → `create_mission()`

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `objective` | string | yes | The durable objective string, e.g. `"Verify 3 clinic contacts can be reached"`. |
| `name` | string | no | Optional human-readable mission name. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "objective": "Verify 3 clinic contacts can be reached",
    "name": "Clinic outreach audit"
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "mis_01H...",
    "objective": "Verify 3 clinic contacts can be reached",
    "name": "Clinic outreach audit",
    "status": "active",
    "created_at": "2026-07-28T14:02:11Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Mission created. |
| 400 | Malformed body or missing `objective`. |
| 401 | Missing or invalid API key. |
| 500 | Upstream failure. |

---

## `GET /ai/missions`

List missions — used to show the resource shape after creation.

**Source:** `create_mission.py` → `list_missions()`

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `page[size]` | integer | no | Page size (sample uses `5`). |

### Example request

```bash
curl -G "$TELNYX_API_BASE/ai/missions" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "page[size]=5"
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "mis_01H...",
      "objective": "Verify 3 clinic contacts can be reached",
      "status": "active",
      "created_at": "2026-07-28T14:02:11Z"
    }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Array of missions. |
| 401 | Missing or invalid API key. |
| 500 | Upstream failure. |

---

## `POST /ai/missions/{mission_id}/runs`

Start one execution of a mission.

**Source:** `start_run.py` → `start_run()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id from `POST /ai/missions`. |

### Request body

Empty object `{}`.

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions/mis_01H.../runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "run_01H...",
    "mission_id": "mis_01H...",
    "status": "pending",
    "created_at": "2026-07-28T14:03:02Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Run created with `RunStatus: pending`. |
| 400 | Malformed body. |
| 404 | Mission not found. |
| 500 | Upstream failure. |

---

## `GET /ai/missions/{mission_id}/runs`

List runs for a mission.

**Source:** `start_run.py` → `list_runs()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |

### Example request

```bash
curl "$TELNYX_API_BASE/ai/missions/mis_01H.../runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "run_01H...",
      "status": "pending",
      "created_at": "2026-07-28T14:03:02Z"
    }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Array of runs. |
| 404 | Mission not found. |
| 500 | Upstream failure. |

---

## `GET /ai/missions/{mission_id}/runs/{run_id}`

Run detail — the source of truth for `RunStatus`, `result_summary`, and `result_payload`. Polled by `audit.py` until terminal.

**Source:** `audit.py` → `wait_for_terminal()`, `_render()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Example request

```bash
curl "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H..." \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "run_01H...",
    "mission_id": "mis_01H...",
    "status": "succeeded",
    "result_summary": "Call campaign completed successfully.",
    "result_payload": null,
    "created_at": "2026-07-28T14:03:02Z",
    "updated_at": "2026-07-28T14:09:41Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Run detail. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `PATCH /ai/missions/{mission_id}/runs/{run_id}`

Update a run — set terminal status and `result_summary`. Used by the worker to mark `running`, `succeeded`, or `failed`.

**Source:** `execute.py` → `update_run()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string (`RunStatus`) | no | New run status. |
| `result_summary` | string | no | Human-readable outcome summary. |
| `result_payload` | object | no | Structured outcome payload. |

### Example request

```bash
curl -X PATCH "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H..." \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "succeeded",
    "result_summary": "Call campaign completed successfully."
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "run_01H...",
    "status": "succeeded",
    "result_summary": "Call campaign completed successfully.",
    "updated_at": "2026-07-28T14:09:41Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Run updated. |
| 400 | Invalid `status` value. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/steps`

Submit the initial plan — the ordered list of steps for the run.

**Source:** `plan_steps.py` → `create_plan()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `steps` | array<object> | yes | Ordered step definitions. |
| `steps[].name` | string | yes | Step name. |
| `steps[].description` | string | no | Step description. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H.../steps" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"name": "Provision assistant", "description": "Create the clinic outreach assistant."},
      {"name": "Schedule outreach call", "description": "Create one scheduled phone-call event."},
      {"name": "Verify outcome", "description": "Confirm the scheduled event reached terminal status."}
    ]
  }'
```

### Response — `200 OK`

```json
{
  "data": [
    {"id": "stp_01H...", "name": "Provision assistant", "status": "pending"},
    {"id": "stp_01I...", "name": "Schedule outreach call", "status": "pending"},
    {"id": "stp_01J...", "name": "Verify outcome", "status": "pending"}
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Plan accepted; steps created with status `pending`. |
| 400 | Malformed `steps` array. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `GET /ai/missions/{mission_id}/runs/{run_id}/steps`

List steps for a run — the planned-versus-completed table in the audit report.

**Source:** `execute.py` (pre-flight check), `audit.py` → `_render()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Example request

```bash
curl "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H.../steps" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    {"id": "stp_01H...", "name": "Provision assistant", "status": "completed"},
    {"id": "stp_01I...", "name": "Schedule outreach call", "status": "completed"},
    {"id": "stp_01J...", "name": "Verify outcome", "status": "completed"}
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Array of steps. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `PATCH /ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}`

Advance a step's status. The worker walks each step `pending → in_progress → completed` (or `failed` on error).

**Source:** `execute.py` → `update_step()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |
| `step_id` | string | yes | Step id. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | yes | One of `pending`, `in_progress`, `completed`, `skipped`, `failed`. |

### Example request

```bash
curl -X PATCH "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H.../steps/stp_01H..." \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "stp_01H...",
    "name": "Provision assistant",
    "status": "in_progress",
    "updated_at": "2026-07-28T14:04:10Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Step status updated. |
| 400 | Invalid `status` value. |
| 404 | Mission, run, or step not found. |
| 500 | Upstream failure. |

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/events`

Log a typed event with `properties`. The worker logs `step_started` / `step_completed` / `step_failed` per transition, plus one `custom` event per call attempt, plus one `status_change` event per observed scheduled-event transition, plus one `error` event on poll timeout.

**Source:** `execute.py` → `log_event()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `event_type` | string (`EventType`) | yes | One of `status_change`, `step_started`, `step_completed`, `step_failed`, `tool_call`, `tool_result`, `message`, `error`, `custom`. |
| `properties` | object | no | Arbitrary structured payload. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H.../events" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "custom",
    "properties": {
      "scheduled_event_id": "evt_01H...",
      "call_status": "completed",
      "telnyx_call_control_id": "v3:...",
      "attempt_number": 1
    }
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "mev_01H...",
    "event_type": "custom",
    "properties": {
      "scheduled_event_id": "evt_01H...",
      "call_status": "completed",
      "telnyx_call_control_id": "v3:...",
      "attempt_number": 1
    },
    "created_at": "2026-07-28T14:08:55Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Event logged. |
| 400 | Invalid `event_type` or malformed `properties`. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `GET /ai/missions/{mission_id}/runs/{run_id}/events`

List events for a run — the audit timeline, sorted by `created_at`.

**Source:** `audit.py` → `_render()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Example request

```bash
curl "$TELNYX_API_BASE/ai/missions/mis_01H.../runs/run_01H.../events" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "mev_01H...",
      "event_type": "step_started",
      "properties": {"step_id": "stp_01H...", "step_name": "Provision assistant"},
      "created_at": "2026-07-28T14:04:09Z"
    },
    {
      "id": "mev_01I...",
      "event_type": "step_completed",
      "properties": {"step_id": "stp_01H...", "step_name": "Provision assistant"},
      "created_at": "2026-07-28T14:04:12Z"
    }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Array of events. |
| 404 | Mission or run not found. |
| 500 | Upstream failure. |

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents`

Link a Telnyx agent (AI assistant) to a run.

**Source:** `execute.py` → `link_agent()`

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission id. |
| `run_id` | string | yes | Run id. |

### Request body

| Field | Type
