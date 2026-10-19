# API Reference — Missions Audit Desk

Typed HTTP contract for the Flask service in `app.py`. Every route maps 1:1 to a step in the CLI flow described in the ticket spec (`create_mission.py`, `start_run.py`, `plan_steps.py`, `execute.py`, `audit.py`).

Base URL (local): `http://localhost:5000`

All request and response bodies are `application/json`.

---

## Enum reference

These enums are validated server-side before any Telnyx API call is made.

### `StepStatus`

| Value | Meaning |
|---|---|
| `pending` | Planned, not yet started. |
| `in_progress` | Worker has begun the step. |
| `completed` | Step finished successfully. |
| `skipped` | Documented in README state table; unused by the demo worker. |
| `failed` | Step errored; run is marked `failed`. |

### `RunStatus`

| Value | Meaning |
|---|---|
| `pending` | Run created, no work started. |
| `running` | Worker is executing steps. |
| `paused` | Documented in README state table; not walked by the demo. |
| `succeeded` | Terminal — all steps completed. |
| `failed` | Terminal — a step failed. |
| `cancelled` | Terminal — documented in README state table. |

### `EventType`

| Value | Meaning |
|---|---|
| `status_change` | Mirrors an observed platform status transition (e.g. scheduled event terminal). |
| `step_started` | Step transitioned to `in_progress`. |
| `step_completed` | Step transitioned to `completed`. |
| `step_failed` | Step transitioned to `failed`. |
| `tool_call` | Reserved for tool invocations. |
| `tool_result` | Reserved for tool results. |
| `message` | Reserved for free-form messages. |
| `error` | Reserved for error events. |
| `custom` | Per-call-attempt record; properties mirror the scheduled-event `call_attempts` entry shape. |

---

## `POST /missions`

Create a mission via `POST /ai/missions`, then list missions to show the resource shape. Maps to `create_mission.py`.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `objective` | string | yes | Durable objective for the mission. Non-empty after trimming. |

### Example request

```bash
curl -s -X POST http://localhost:5000/missions \
  -H 'Content-Type: application/json' \
  -d '{"objective": "Verify 3 clinic contacts can be reached"}'
```

### Response — `201 Created`

```json
{
  "mission": {
    "id": "msn_01H...",
    "objective": "Verify 3 clinic contacts can be reached",
    "created_at": "2026-01-01T00:00:00+00:00"
  },
  "missions": {
    "data": [
      { "id": "msn_01H...", "objective": "Verify 3 clinic contacts can be reached" }
    ]
  },
  "created_at": "2026-01-01T00:00:00+00:00"
}
```

### Status codes

| Code | Meaning |
|---|---|
| `201` | Mission created; list returned. |
| `400` | `objective` missing or empty. |
| `502` | Telnyx API call failed (details logged server-side, not returned). |

---

## `POST /missions/<mission_id>/runs`

Start a run via `POST /ai/missions/{mission_id}/runs`. Initial status is `pending`. Maps to `start_run.py`.

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission identifier returned by `POST /missions`. |

### Request body

None.

### Example request

```bash
curl -s -X POST http://localhost:5000/missions/msn_01H.../runs
```

### Response — `201 Created`

```json
{
  "run": {
    "id": "run_01H...",
    "mission_id": "msn_01H...",
    "status": "pending"
  },
  "initial_status": "pending"
}
```

### Status codes

| Code | Meaning |
|---|---|
| `201` | Run created. |
| `502` | Telnyx API call failed. |

---

## `POST /missions/<mission_id>/runs/<run_id>/steps`

Submit the initial plan via `POST /ai/missions/{mission_id}/runs/{run_id}/steps`. Maps to `plan_steps.py`.

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission identifier. |
| `run_id` | string | yes | Run identifier returned by `POST .../runs`. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `steps` | array\<object\> | no | Plan steps. If omitted, the default 3-step plan is used (see below). Must be a non-empty list when provided. |
| `steps[].name` | string | yes (per step) | Short step name. |
| `steps[].description` | string | no | Longer description of the step. |

Default plan when `steps` is omitted:

1. `provision assistant` — Create the demo outreach assistant.
2. `schedule outreach call` — Create one scheduled phone-call event.
3. `verify outcome` — Confirm the scheduled event reached terminal status.

### Example request

```bash
curl -s -X POST http://localhost:5000/missions/msn_01H.../runs/run_01H.../steps \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response — `201 Created`

```json
{
  "plan": {
    "steps": [
      { "id": "stp_01", "name": "provision assistant", "status": "pending" },
      { "id": "stp_02", "name": "schedule outreach call", "status": "pending" },
      { "id": "stp_03", "name": "verify outcome", "status": "pending" }
    ]
  },
  "step_ids": ["stp_01", "stp_02", "stp_03"]
}
```

### Status codes

| Code | Meaning |
|---|---|
| `201` | Plan created. |
| `400` | `steps` provided but empty or not a list. |
| `502` | Telnyx API call failed. |

---

## `POST /missions/<mission_id>/runs/<run_id>/execute`

Run the campaign worker. Maps to `execute.py`. Walks each step `pending → in_progress → completed` (or `failed`), logs typed events, links the assistant to the run, and updates the run's terminal status.

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission identifier. |
| `run_id` | string | yes | Run identifier. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `step_ids` | array\<string\> | yes | Exactly 3 step IDs, in plan order: `[provision, schedule, verify]`. |

### Example request

```bash
curl -s -X POST http://localhost:5000/missions/msn_01H.../runs/run_01H.../execute \
  -H 'Content-Type: application/json' \
  -d '{"step_ids": ["stp_01", "stp_02", "stp_03"]}'
```

### Response — `200 OK`

```json
{
  "assistant_id": "asst_01H...",
  "call_status": "completed",
  "linked_agents": {
    "telnyx_agents": [
      {
        "run_id": "run_01H...",
        "telnyx_agent_id": "asst_01H...",
        "created_at": "2026-01-01T00:00:00+00:00"
      }
    ]
  },
  "completed_at": "2026-01-01T00:00:00+00:00"
}
```

### Worker behavior

| Step | Action | Events logged |
|---|---|---|
| 1 — provision assistant | `PATCH .../steps/{step1}` → `in_progress`; create assistant (or reuse `ASSISTANT_ID`); `PATCH` → `completed`. | `step_started`, `step_completed` |
| 2 — schedule outreach call | `PATCH .../steps/{step2}` → `in_progress`; create scheduled event (or demo stub); `PATCH` → `completed`. | `step_started`, `custom`, `step_completed` |
| 3 — verify outcome | `PATCH .../steps/{step3}` → `in_progress`; poll scheduled event to terminal; `PATCH` → `completed` or `failed`. | `step_started`, `status_change` (live mode), `step_completed` or `step_failed` |
| Link | `POST .../telnyx-agents` with `{"telnyx_agent_id": "<assistant_id>"}`, then `GET .../telnyx-agents`. | — |
| Run update | `PATCH .../runs/{run_id}` with `status` = `succeeded` or `failed`, plus `result_summary` and `result_payload`. | — |

The `custom` event properties mirror the scheduled-event `call_attempts` entry shape:

```json
{
  "scheduled_event_id": "evt_01H...",
  "call_status": "completed",
  "telnyx_call_control_id": "v3:...",
  "attempt_number": 1
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Worker completed; run marked `succeeded` or `failed`. |
| `400` | `step_ids` missing or not exactly 3 entries. |
| `502` | Worker raised (e.g. `ASSISTANT_PHONE_NUMBER` unset in live mode, Telnyx API error). Details logged server-side. |

---

## `GET /missions/audit/<mission_id>/<run_id>`

Render the audit report. Maps to `audit.py`. Fetches mission, run, steps, events, and linked agents in one pass and returns a chronological ledger.

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission identifier. |
| `run_id` | string | yes | Run identifier. |

### Example request

```bash
curl -s http://localhost:5000/missions/audit/msn_01H.../run_01H...
```

### Response — `200 OK`

```json
{
  "mission": {
    "id": "msn_01H...",
    "objective": "Verify 3 clinic contacts can be reached"
  },
  "run": {
    "id": "run_01H...",
    "status": "succeeded",
    "result_summary": "outreach call completed",
    "result_payload": { "call_status": "completed" }
  },
  "steps": [
    {
      "step_id": "stp_01",
      "name": "provision assistant",
      "planned_status": "pending",
      "current_status": "completed",
      "completed": true
    }
  ],
  "events": [
    {
      "event_id": "evt_01H...",
      "event_type": "step_started",
      "properties": { "step_id": "stp_01", "step_name": "provision assistant" },
      "created_at": "2026-01-01T00:00:00+00:00"
    }
  ],
  "linked_agents": [
    {
      "run_id": "run_01H...",
      "telnyx_agent_id": "asst_01H...",
      "created_at": "2026-01-01T00:00:00+00:00"
    }
  ],
  "run_status_enum": ["pending", "running", "paused", "succeeded", "failed", "cancelled"],
  "step_status_enum": ["pending", "in_progress", "completed", "skipped", "failed"],
  "event_type_enum": ["status_change", "step_started", "step_completed", "step_failed", "tool_call", "tool_result", "message", "error", "custom"],
  "rendered_at": "2026-01-01T00:00:00+00:00"
}
```

### Response fields

| Field | Type | Description |
|---|---|---|
| `mission.id` | string | Mission identifier. |
| `mission.objective` | string | Durable objective. |
| `run.id` | string | Run identifier. |
| `run.status` | `RunStatus` | Final run status. |
| `run.result_summary` | string \| null | Human-readable outcome set by the worker. |
| `run.result_payload` | object \| null | Structured outcome (e.g. `{"failing_step_id": "stp_03", "call_status": "failed"}`). |
| `steps[].step_id` | string | Step identifier. |
| `steps[].name` | string | Step name from the plan. |
| `steps[].planned_status` | string | Always `pending` — the status at plan time. |
| `steps[].current_status` | `StepStatus` | Status at render time. |
| `steps[].completed` | boolean | `true` iff `current_status == "completed"`. |
| `events[].event_id` | string | Event identifier. |
| `events[].event_type` | `EventType` | Typed event. |
| `events[].properties` | object | Event-specific payload (e.g. `step_id`, `step_name`, `call_status`). |
| `events[].created_at` | string (ISO 8601) | Event timestamp. |
| `linked_agents[].run_id` | string | Run the agent is linked to. |
| `linked_agents[].telnyx_agent_id` | string | Assistant identifier. |
| `linked_agents[].created_at` | string (ISO 8601) | Link creation timestamp. |
| `run_status_enum` | array\<string\> | Full `RunStatus` enum, printed in the report. |
| `step_status_enum` | array\<string\> | Full `StepStatus` enum. |
| `event_type_enum` | array\<string\> | Full `EventType` enum. |
| `rendered_at` | string (ISO 8601) | When the report was rendered. |

### Status codes

| Code | Meaning |
|---|---|
| `200` | Report rendered. |
| `502` | One of the underlying Telnyx reads failed. Details logged server-side. |

---

## `GET /health`

Liveness probe. Reports whether the service is running in demo mode.

### Example request

```bash
curl -s http://localhost:5000/health
```

### Response — `200 OK`

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Service is up. |

---

## Environment variables consumed by the API

| Variable | Used by | Description |
|---|---|---|
| `TELNYX_API_KEY` | all routes | Telnyx API key. Required at startup; the app raises if unset. |
| `DEMO_MODE` | `POST .../execute` | `true` (default) skips the real scheduled-event call. `false` places a real call. |
| `DESTINATION_NUMBER` | `POST .../execute` | End-user phone number for the scheduled event. Placeholder `+1555XXXXXXXX` by default. |
| `ASSISTANT_PHONE_NUMBER` | `POST .../execute` | Phone number associated with the assistant in the Telnyx portal. Required in live mode. |
| `ASSISTANT_ID` | `POST .../execute` | Reuse an existing assistant instead of creating one. |
| `POLL_INTERVAL_SECONDS` | `POST .../execute` | Scheduled-event poll interval. Default `5`. |
| `POLL_TIMEOUT_SECONDS` | `POST .../execute` | Scheduled-event poll hard cap. Default `600`. |
| `PORT` | `__main__` | Flask bind port. Default `5000`. |

---

## Error response shape

All non-2xx responses from application routes use the same envelope:

```json
{ "error": "objective is required" }
```

Error messages are generic; exception details are logged via `app.logger.exception(...)` and never returned to the client.
