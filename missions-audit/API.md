# API Reference — Missions Audit Desk

Typed contract for every Telnyx API route this sample calls, plus the CLI surface of each workflow script. All routes are called through the Telnyx Python SDK (`telnyx.Telnyx`) against the base URL `https://api.telnyx.com/v2`.

Authentication: `Authorization: Bearer $TELNYX_API_KEY` on every request. The SDK injects this header from the `TELNYX_API_KEY` environment variable.

---

## Missions

### `POST /ai/missions`

Create a mission — the durable objective that persists across runs.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `objective` | string | yes | Human-readable objective text. Default in `create_mission.py`: `"Verify 3 clinic contacts can be reached"`. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/missions \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"objective": "Verify 3 clinic contacts can be reached"}'
```

**Response — `200 OK`**

```json
{
  "id": "mission_01H...",
  "objective": "Verify 3 clinic contacts can be reached",
  "status": "pending",
  "created_at": "2026-07-28T12:00:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Mission created. |
| 400 | Missing or malformed `objective`. |
| 401 | Missing or invalid API key. |
| 500 | Upstream failure. |

---

### `GET /ai/missions`

List missions. Used by `create_mission.py` to print the resource shape after creation.

**Request body** — none.

**Example request**

```bash
curl https://api.telnyx.com/v2/ai/missions \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "mission_01H...",
      "objective": "Verify 3 clinic contacts can be reached",
      "status": "pending"
    }
  ]
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | List returned (may be empty). |
| 401 | Missing or invalid API key. |
| 500 | Upstream failure. |

---

### `GET /ai/missions/{mission_id}`

Fetch a single mission. Called by `audit.py` for the cross-check GET before rendering.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission ID returned by create. |

**Example request**

```bash
curl https://api.telnyx.com/v2/ai/missions/mission_01H... \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response — `200 OK`**

```json
{
  "id": "mission_01H...",
  "objective": "Verify 3 clinic contacts can be reached",
  "status": "pending"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Mission returned. |
| 401 | Missing or invalid API key. |
| 404 | No mission with that ID. |
| 500 | Upstream failure. |

---

## Runs

### `POST /ai/missions/{mission_id}/runs`

Start a run — one execution of the mission. Called by `start_run.py`.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Mission to run. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| *(none)* | — | — | Empty body `{}`. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/missions/mission_01H.../runs \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response — `200 OK`**

```json
{
  "id": "run_01H...",
  "mission_id": "mission_01H...",
  "status": "pending",
  "created_at": "2026-07-28T12:01:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Run created. |
| 400 | Mission not in a runnable state. |
| 401 | Missing or invalid API key. |
| 404 | No mission with that ID. |
| 500 | Upstream failure. |

---

### `GET /ai/missions/{mission_id}/runs/{run_id}`

Run detail. Polled by `audit.py` until the run reaches a terminal status, and re-fetched for the cross-check.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Run to fetch. |

**Example request**

```bash
curl https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H... \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response — `200 OK`**

```json
{
  "id": "run_01H...",
  "mission_id": "mission_01H...",
  "status": "succeeded",
  "result_summary": "Call campaign completed.",
  "result_payload": null,
  "created_at": "2026-07-28T12:01:00Z",
  "updated_at": "2026-07-28T12:04:00Z"
}
```

`status` is a `RunStatus` enum value:

| Value | Meaning |
|---|---|
| `pending` | Run created, not yet started. |
| `running` | Run is executing steps. |
| `paused` | Run paused by operator. |
| `succeeded` | Run completed successfully. |
| `failed` | Run failed; see `result_summary`. |
| `cancelled` | Run cancelled by operator. |

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Run returned. |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

### `PATCH /ai/missions/{mission_id}/runs/{run_id}`

Update run status and result fields. Called by `execute.py` to mark the run `succeeded` or `failed` once the scheduled event reaches terminal status.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Run to update. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | no | `RunStatus` value. The worker sets `succeeded` or `failed`. |
| `result_summary` | string | no | Short human-readable outcome. Set to `"Call campaign completed."` on success, or `"Scheduled event {event_id} ended as {status}."` on failure. |
| `result_payload` | object | no | Structured outcome payload. Not set by this sample. |

**Example request**

```bash
curl -X PATCH https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H... \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "succeeded", "result_summary": "Call campaign completed."}'
```

**Response — `200 OK`**

```json
{
  "id": "run_01H...",
  "status": "succeeded",
  "result_summary": "Call campaign completed.",
  "updated_at": "2026-07-28T12:04:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Run updated. |
| 400 | Invalid `status` value or malformed body. |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

## Steps

### `POST /ai/missions/{mission_id}/runs/{run_id}/steps`

Submit the initial plan. Called by `plan_steps.py` with a fixed three-step plan.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Run to plan. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `steps` | array | yes | Ordered list of step objects. |
| `steps[].name` | string | yes | Step name. |
| `steps[].description` | string | no | Step description. |

The plan submitted by `plan_steps.py`:

| # | `name` | `description` |
|---|---|---|
| 1 | `provision assistant` | Create the clinic outreach assistant. |
| 2 | `schedule outreach call` | Schedule one phone-call event. |
| 3 | `verify outcome` | Confirm the call reached terminal status. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H.../steps \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"name": "provision assistant", "description": "Create the clinic outreach assistant."},
      {"name": "schedule outreach call", "description": "Schedule one phone-call event."},
      {"name": "verify outcome", "description": "Confirm the call reached terminal status."}
    ]
  }'
```

**Response — `200 OK`**

```json
{
  "steps": [
    {"id": "step_01H...", "name": "provision assistant", "status": "pending"},
    {"id": "step_01H...", "name": "schedule outreach call", "status": "pending"},
    {"id": "step_01H...", "name": "verify outcome", "status": "pending"}
  ]
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Plan accepted; step IDs returned. |
| 400 | Malformed `steps` array. |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

### `PATCH /ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}`

Advance a step's status. Called by `execute.py` on every step transition.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Parent run. |
| `step_id` | string | yes | Step to update. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | yes | Step status enum value. |

Step status enum:

| Value | Meaning |
|---|---|
| `pending` | Planned, not started. |
| `in_progress` | Worker is executing this step. |
| `completed` | Step finished successfully. |
| `skipped` | Step intentionally not executed. Documented in the README state table; unused by this sample. |
| `failed` | Step failed; see the run's `result_summary`. |

The demo walks each step `pending → in_progress → completed`, or `pending → in_progress → failed` when the scheduled event ends in `failed`.

**Example request**

```bash
curl -X PATCH https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H.../steps/step_01H... \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

**Response — `200 OK`**

```json
{
  "id": "step_01H...",
  "name": "provision assistant",
  "status": "in_progress",
  "updated_at": "2026-07-28T12:02:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Step updated. |
| 400 | Invalid `status` value. |
| 401 | Missing or invalid API key. |
| 404 | No step with that ID under that run. |
| 500 | Upstream failure. |

---

## Events

### `POST /ai/missions/{mission_id}/runs/{run_id}/events`

Log a typed event. Called by `execute.py` on every step transition and once per call attempt.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Parent run. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `event_type` | string | yes | `EventType` enum value. |
| `properties` | object | no | Free-form event payload. |

`EventType` enum:

| Value | Meaning |
|---|---|
| `status_change` | A status transition was observed. |
| `step_started` | A step began executing. |
| `step_completed` | A step finished successfully. |
| `step_failed` | A step failed. |
| `tool_call` | A tool was invoked. |
| `tool_result` | A tool returned. |
| `message` | A message was exchanged. |
| `error` | An error occurred. |
| `custom` | Caller-defined event. |

Events logged by this sample:

| `event_type` | `properties` |
|---|---|
| `step_started` | `{"step_id": "<id>", "step_name": "<name>"}` |
| `step_completed` | `{"step_id": "<id>", "step_name": "<name>"}` |
| `step_failed` | `{"step_id": "<id>", "step_name": "<name>"}` |
| `custom` | `{"scheduled_event_id": "<id>", "call_status": "<status>", "telnyx_call_control_id": null, "attempt_number": 1}` |

The `custom` event mirrors the scheduled-event `call_attempts` entry shape so the ledger records the platform's response, not just the worker's actions.

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H.../events \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "step_started",
    "properties": {"step_id": "step_01H...", "step_name": "provision assistant"}
  }'
```

**Response — `200 OK`**

```json
{
  "id": "evt_01H...",
  "event_type": "step_started",
  "properties": {"step_id": "step_01H...", "step_name": "provision assistant"},
  "created_at": "2026-07-28T12:02:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Event logged. |
| 400 | Invalid `event_type` or malformed `properties`. |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

## Linked Telnyx Agents

### `POST /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents`

Link a Telnyx AI assistant to the run. Called by `execute.py` after the campaign completes.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Parent run. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_agent_id` | string | yes | The assistant ID created (or reused) by `execute.py`. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H.../telnyx-agents \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"telnyx_agent_id": "assistant_01H..."}'
```

**Response — `200 OK`**

```json
{
  "run_id": "run_01H...",
  "telnyx_agent_id": "assistant_01H...",
  "created_at": "2026-07-28T12:04:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Agent linked. |
| 400 | Missing `telnyx_agent_id`. |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

### `GET /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents`

List agents linked to the run. Called by `execute.py` immediately after linking, and by `audit.py` for the cross-check.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mission_id` | string | yes | Parent mission. |
| `run_id` | string | yes | Parent run. |

**Example request**

```bash
curl https://api.telnyx.com/v2/ai/missions/mission_01H.../runs/run_01H.../telnyx-agents \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response — `200 OK`**

```json
{
  "data": [
    {
      "run_id": "run_01H...",
      "telnyx_agent_id": "assistant_01H...",
      "created_at": "2026-07-28T12:04:00Z"
    }
  ]
}
```

`TelnyxAgentData` fields:

| Field | Type | Description |
|---|---|---|
| `run_id` | string | The run this agent is linked to. |
| `telnyx_agent_id` | string | The Telnyx AI assistant ID. |
| `created_at` | string (ISO 8601) | When the link was created. |

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Linkage list returned (may be empty). |
| 401 | Missing or invalid API key. |
| 404 | No run with that ID under that mission. |
| 500 | Upstream failure. |

---

## Worker Primitives (AI Assistants)

### `POST /ai/assistants`

Create the demo assistant. Called by `execute.py` unless `ASSISTANT_ID` is set in the environment.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Assistant name. Set to `"clinic-outreach"`. |
| `instructions` | string | no | System prompt. Set to the clinic outreach instructions. |
| `model` | string | no | Omitted — platform default applies. |
| `voice` | string | no | Omitted — platform default applies. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "clinic-outreach",
    "instructions": "You are a clinic outreach agent: verify the contact is reachable, confirm the appointment slot briefly, stay polite."
  }'
```

**Response — `200 OK`**

```json
{
  "id": "assistant_01H...",
  "name": "clinic-outreach",
  "created_at": "2026-07-28T12:02:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Assistant created. |
| 400 | Malformed body. |
| 401 | Missing or invalid API key. |
| 500 | Upstream failure. |

---

### `POST /ai/assistants/{assistant_id}/scheduled_events`

Schedule one phone-call event for the assistant. Called by `execute.py` in live mode only.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string | yes | Assistant to drive the call. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `event_type` | string | yes | Set to `"phone_call"`. |
| `telnyx_agent_target` | string | yes | Phone number associated with the assistant, from `ASSISTANT_PHONE_NUMBER`. |
| `telnyx_end_user_target` | string | yes | Destination number, from `DESTINATION_NUMBER`. |

**Example request**

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants/assistant_01H.../scheduled_events \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "phone_call",
    "telnyx_agent_target": "+1555XXXXXXXX",
    "telnyx_end_user_target": "+1555YYYYYYYY"
  }'
```

**Response — `200 OK`**

```json
{
  "id": "sched_evt_01H...",
  "status": "pending",
  "created_at": "2026-07-28T12:03:00Z"
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Event scheduled. |
| 400 | Missing target fields or malformed body. |
| 401 | Missing or invalid API key. |
| 404 | No assistant with that ID. |
| 500 | Upstream failure. |

---

### `GET /ai/assistants/{assistant_id}/scheduled_events/{event_id}`

Poll a scheduled event until it reaches terminal status. Called by `execute.py` every 5 seconds, hard cap 10 minutes.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string | yes | Assistant that owns the event. |
| `event_id` | string | yes | Scheduled event to poll. |

**Example request**

```bash
curl https://api.telnyx.com/v2/ai/assistants/assistant_01H.../scheduled_events/sched_evt_01H... \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response — `200 OK`**

```json
{
  "id": "sched_evt_01H...",
  "status": "completed",
  "call_attempts": [
    {
      "attempt_number": 1,
      "call_status": "completed",
      "telnyx_call_control_id": "v3:01H..."
    }
  ]
}
```

`status` is an `EventStatus` enum value:

| Value | Meaning |
|---|---|
| `pending` | Scheduled, not yet started. |
| `in_progress` | Call is in flight. |
| `completed` | Terminal — call finished successfully. Maps to step `completed`. |
| `failed` | Terminal — call failed. Maps to step `failed`. |

Every observed status change is mirrored as a missions event (the honesty contract).

**Status codes**

| Code | Meaning |
|---|---|
| 200 | Event returned. |
| 401 | Missing or invalid API key. |
| 404 | No event with that ID under that assistant. |
| 500 | Upstream failure. |

---

## CLI Surface

Each workflow script is a standalone CLI. All accept `--help`.

### `python app.py`

Thin dispatcher. Prints the workflow script list and exits. No API calls.

### `python create_mission.py`

| Flag | Default | Description |
|---|---|---|
| `--objective` | `"Verify 3 clinic contacts can be reached"` | Mission objective text. |

Calls `POST /ai/missions`, then `GET /ai/missions`. Prints the new `mission_id`.

### `python start_run.py`

| Flag | Default | Description |
|---|---|---|
| `--mission-id` | `$MISSION_ID` | Mission to run. Required if env unset. |

Calls `POST /ai/missions/{mission_id}/runs`. Prints the new `run_id` and initial status.

### `python plan_steps.py`

| Flag | Default | Description |
|---|---|---|
| `--mission-id` | `$MISSION_ID` | Parent mission. Required if env unset. |
| `--run-id` | `$RUN_ID` | Run to plan. Required if env unset. |

Calls `POST /ai/missions/{mission_id}/runs/{run_id}/steps` with the fixed three-step plan. Prints each step ID.

### `python execute.py`

| Flag | Default | Description |
|---|---|---|
| `--mission-id` | `$MISSION_ID` | Parent mission. Required if env unset. |
| `--run-id` | `$RUN_ID` | Parent run. Required if env unset. |
| `--step-ids` | `$STEP_IDS` | Comma-separated step IDs in plan order. Required if env unset. |

Runs the campaign. In demo mode (`DEMO_MODE=true`, the default) no real call is placed; the scheduled event ID is the literal `demo-scheduled-event` and the final status is forced to `completed`. In live mode it creates the assistant, schedules the call, polls to terminal status, advances each step, logs typed events, marks the run, and links the assistant.

### `python audit.py`

| Flag | Default | Description |
|---|---|---|
| `--mission-id` | `$MISSION_ID` | Parent mission. Required if env unset. |
| `--run-id` | `$RUN_ID` | Run to audit. Required if env unset. |

Polls `GET .../runs/{run_id}` until terminal (5s interval, 600s cap), then re-fetches mission, run, steps, events, and linked agents before rendering the report. Prints the full `RunStatus` state table at the end.

### `python smoke_test.py`

No flags. Imports every workflow module and asserts each exposes `_main()`. Run with `pytest smoke_test.py`.

---

## Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `TELNYX_API_KEY` | all scripts | Telnyx API key. Required. |
| `MISSION_ID` | `start_run.py`, `plan_steps.py`, `execute.py`, `audit.py` | Mission ID from step 1. |
| `RUN_ID` | `plan_steps.py`, `execute.py`, `audit.py` | Run ID from step 2. |
| `STEP_IDS` | `execute.py` | Comma-separated step IDs from step 3. |
| `ASSISTANT_ID` | `execute.py` | Reuse an existing assistant instead of creating one. Optional. |
| `ASSISTANT_PHONE_NUMBER` | `execute.py` | Phone number associated with the assistant in the portal. Required in live mode. |
| `DESTINATION_NUMBER` | `execute.py` | Number to call. Required in live mode. |
| `DEMO_MODE` | `execute.py` | `true` (default) skips the real call. Set `false` for live mode. |

---

## Error Handling

Every script exits with a non-zero status and a single actionable message when a required env var is missing. HTTP errors from the SDK propagate as exceptions; the scripts do not swallow them, so the audit trail is never silently truncated. `audit.py` treats a poll timeout as a non-terminal run and renders whatever state the API last returned.
