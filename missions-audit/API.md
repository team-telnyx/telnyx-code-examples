# API Reference — Missions Audit Desk

Typed contract for every Telnyx endpoint this sample calls. Shapes were verified against the Missions and Assistants OpenAPI specs (`developers.telnyx.com/api-reference/missions`, `.../assistants`) and exercised live.

**Envelope convention — the one that trips everyone:**

| Surface | Response shape | Resource id field |
|---|---|---|
| Missions (`/ai/missions/...`) | Wrapped: `{"data": <object or array>}` | `mission_id`, `run_id`, `step_id`, `event_id` |
| Assistants + scheduled events (`/ai/assistants/...`) | **Bare object** (no envelope) | `id` (assistant), `scheduled_event_id` (event) |

All routes are invoked as raw REST against `TELNYX_API_BASE` (default `https://api.telnyx.com/v2`) with `Authorization: Bearer $TELNYX_API_KEY` and `Content-Type: application/json`.

---

## Common conventions

| Item | Value |
|---|---|
| Base URL | `TELNYX_API_BASE` env, default `https://api.telnyx.com/v2` |
| Auth header | `Authorization: Bearer <TELNYX_API_KEY>` |
| Content type | `application/json` |
| Missions response envelope | `{"data": <object or array>}` |
| Missions error envelope | `{"errors": [{"code": ..., "title": ..., "detail": ...}]}` |
| Assistants response | bare JSON object/array (no envelope) |

### Enums (from the OpenAPI specs)

**`RunStatus`** — `pending` | `running` | `paused` | `succeeded` | `failed` | `cancelled`

**`StepStatus`** — `pending` | `in_progress` | `completed` | `skipped` | `failed`

**`EventType`** — `status_change` | `step_started` | `step_completed` | `step_failed` | `tool_call` | `tool_result` | `message` | `error` | `custom`

**`EventStatus`** (scheduled events) — `pending` | `in_progress` | `completed` | `failed`

**`CallStatus`** (per-call, inside `call_attempts`) — `busy` | `canceled` | `no-answer` | `ringing` | `completed` | `failed` | `in-progress`

---

## `POST /ai/missions`

Create a mission — the durable objective that persists across runs. `201 Created`.

**Source:** `create_mission.py` → `create_mission()`

### Request body (`CreateMissionRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **yes** | Human-readable mission name. |
| `description` | string | no | The objective text (e.g. `"Verify 3 clinic contacts can be reached"`). |
| `model` | string | no | Inference model for platform-executed missions. |
| `instructions` | string | no | System instructions for the mission's agent. |
| `execution_mode` | string | no | `external` (default) — a worker script drives the run. |
| `metadata` | object | no | Free-form metadata. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Clinic outreach audit",
    "description": "Verify 3 clinic contacts can be reached",
    "instructions": "You are a clinic outreach agent: verify the contact is reachable, confirm the appointment slot briefly, stay polite.",
    "execution_mode": "external"
  }'
```

### Response — `201 Created`

```json
{
  "data": {
    "mission_id": "ac41d1eb-8388-437f-89b3-b1c09654a936",
    "organization_id": "...",
    "user_id": "...",
    "name": "Clinic outreach audit",
    "description": "Verify 3 clinic contacts can be reached",
    "model": null,
    "instructions": "You are a clinic outreach agent...",
    "execution_mode": "external",
    "metadata": null,
    "created_at": "2026-10-20T02:07:10.921104Z",
    "updated_at": "2026-10-20T02:07:10.921104Z"
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 201 | Mission created. |
| 422 | Validation error (e.g. missing `name`). |

---

## `GET /ai/missions`

List missions. Query params: `page[number]`, `page[size]`.

**Source:** `create_mission.py` → `list_missions()`

### Response — `200 OK`

```json
{
  "data": [
    {
      "mission_id": "a7c0d988-...",
      "name": "Clinic outreach audit",
      "description": "Verify 3 clinic contacts can be reached",
      "execution_mode": "external",
      "created_at": "2026-02-24T23:38:04.819891Z",
      "updated_at": "2026-02-24T23:38:04.819891Z"
    }
  ],
  "meta": {"total_pages": 6, "total_results": 12, "page_number": 1, "page_size": 2}
}
```

---

## `GET /ai/missions/{mission_id}`

Mission detail. **Source:** `audit.py` → `_render()`. Response is a single `MissionData` object inside `data` (same fields as above).

---

## `POST /ai/missions/{mission_id}/runs`

Start one execution of the mission. `201 Created`.

**Source:** `start_run.py` → `start_run()`

### Request body (`CreateMissionRunRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | object | no | Run input. |
| `metadata` | object | no | Free-form metadata. |

The sample sends an empty object `{}`.

### Response — `201 Created`

```json
{
  "data": {
    "run_id": "fb398223-ea56-45ca-a239-1c2944a61953",
    "mission_id": "ac41d1eb-8388-437f-89b3-b1c09654a936",
    "status": "pending",
    "input": null,
    "started_at": "2026-10-20T02:07:11.510880Z",
    "finished_at": null,
    "result_summary": null,
    "result_payload": null,
    "error": null,
    "metadata": null,
    "updated_at": "2026-10-20T02:07:11.510880Z"
  }
}
```

---

## `GET /ai/missions/{mission_id}/runs`

List runs for a mission. **Source:** `start_run.py` → `list_runs()`. Response: `{"data": [<MissionRunData>, ...]}`.

---

## `GET /ai/missions/{mission_id}/runs/{run_id}`

Run detail — the source of truth for `RunStatus`, `result_summary`, and `result_payload`. Polled by `audit.py` until terminal.

**Source:** `audit.py` → `wait_for_terminal()`, `_render()`

### Response — `200 OK`

Same shape as the run-create response; after completion `status` is `succeeded`|`failed`|`cancelled`, `result_summary`/`result_payload`/`error` are populated, and `finished_at` is set.

---

## `PATCH /ai/missions/{mission_id}/runs/{run_id}`

Update a run — set status, `result_summary`, `result_payload`, `error`, or `metadata`. Used by the worker to mark `running`, `succeeded`, or `failed` (pause/resume/cancel are dedicated `POST .../runs/{run_id}/{pause,resume,cancel}` endpoints).

**Source:** `execute.py` → `update_run()`

### Request body (`UpdateMissionRunRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string (`RunStatus`) | no | New run status. |
| `result_summary` | string | no | Human-readable outcome summary. |
| `result_payload` | object | no | Structured outcome payload. |
| `error` | string | no | Error detail on failure. |
| `metadata` | object | no | Free-form metadata. |

### Example request

```bash
curl -X PATCH "$TELNYX_API_BASE/ai/missions/$MISSION_ID/runs/$RUN_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "succeeded", "result_summary": "Call campaign completed successfully."}'
```

### Response — `200 OK` — updated `MissionRunData` in `data`.

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/plan`

Submit the initial plan — the ordered list of steps for the run. `201 Created`. (Steps can also be appended to an existing plan via `POST .../plan/steps` with the same step shape.)

**Source:** `plan_steps.py` → `create_plan()`

### Request body (`CreatePlanRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `steps` | array | yes | Ordered step definitions. |
| `steps[].step_id` | string | **yes** | Client-chosen id (e.g. `provision_assistant`); used in all later step PATCHes. |
| `steps[].description` | string | **yes** | Human-readable step label (there is no separate `name` field). |
| `steps[].sequence` | integer | **yes** | 1-based order. |
| `steps[].parent_step_id` | string | no | For sub-steps. |
| `steps[].metadata` | object | no | Free-form metadata. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions/$MISSION_ID/runs/$RUN_ID/plan" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"step_id": "provision_assistant", "description": "Provision assistant - create the clinic outreach assistant.", "sequence": 1},
      {"step_id": "schedule_outreach_call", "description": "Schedule outreach call - create one scheduled phone-call event.", "sequence": 2},
      {"step_id": "verify_outcome", "description": "Verify outcome - confirm the scheduled event reached terminal status.", "sequence": 3}
    ]
  }'
```

### Response — `201 Created` — `{"data": [<PlanStepData>, ...]}` where each step is:

```json
{
  "step_id": "provision_assistant",
  "run_id": "fb398223-...",
  "parent_step_id": null,
  "sequence": 1,
  "description": "Provision assistant - create the clinic outreach assistant.",
  "status": "pending",
  "started_at": null,
  "completed_at": null,
  "metadata": null
}
```

---

## `GET /ai/missions/{mission_id}/runs/{run_id}/plan`

Fetch the planned steps — the planned-versus-completed table in the audit report.

**Source:** `plan_steps.py` → `get_plan()`, `execute.py` (pre-flight check), `audit.py` → `_render()`

### Response — `200 OK` — `{"data": [<PlanStepData>, ...]}` (same step shape as above; `status` moves `pending` → `in_progress` → `completed`|`failed` as the worker advances them, with `started_at`/`completed_at` set by the platform).

---

## `PATCH /ai/missions/{mission_id}/runs/{run_id}/plan/steps/{step_id}`

Advance a step's status. The worker walks each step `pending` → `in_progress` → `completed` (or `failed` on error).

**Source:** `execute.py` → `update_step()`

### Request body (`UpdatePlanStepRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string (`StepStatus`) | yes | One of `pending`, `in_progress`, `completed`, `skipped`, `failed`. |
| `metadata` | object | no | Free-form metadata. |

### Response — `200 OK` — updated `PlanStepData` in `data` (the platform stamps `started_at`/`completed_at`).

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/events`

Log a typed event. `type` and `summary` are **required**; `payload` is the free-form object. The worker logs `step_started` / `step_completed` / `step_failed` per step transition, `status_change` per observed scheduled-event transition, `custom` per call attempt, and `error` for worker-side problems (poll timeout, linkage failure).

**Source:** `execute.py` → `log_event()`

### Request body (`CreateEventRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string (`EventType`) | **yes** | One of the `EventType` values. |
| `summary` | string | **yes** | Human-readable one-liner. |
| `step_id` | string | no | Associates the event with a plan step. |
| `agent_id` | string | no | Associates the event with an agent. |
| `payload` | object | no | Free-form structured payload. |
| `idempotency_key` | string | no | Prevents duplicate events on retry. |

### Example request

```bash
curl -X POST "$TELNYX_API_BASE/ai/missions/$MISSION_ID/runs/$RUN_ID/events" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "custom",
    "summary": "Call attempt recorded (completed)",
    "step_id": "schedule_outreach_call",
    "payload": {
      "scheduled_event_id": "evt-...",
      "call_status": "completed",
      "telnyx_call_control_id": "v3:...",
      "attempt_number": 1
    }
  }'
```

### Response — `201 Created`

```json
{
  "data": {
    "event_id": "9191afde-023d-4552-a8b0-dce159e2a3b6",
    "run_id": "fb398223-...",
    "type": "custom",
    "summary": "Call attempt recorded (completed)",
    "timestamp": "2026-10-20T02:07:15.673345Z",
    "step_id": "schedule_outreach_call",
    "agent_id": null,
    "payload": {"call_status": "completed", "attempt_number": 1},
    "idempotency_key": null
  }
}
```

---

## `GET /ai/missions/{mission_id}/runs/{run_id}/events`

List events for a run — the audit timeline, sorted by `timestamp`. Query params: `type`, `step_id`, `agent_id`, `page[number]`, `page[size]`.

**Source:** `audit.py` → `_render()`. Response: `{"data": [<EventData>, ...]}` (each event: `event_id`, `run_id`, `type`, `summary`, `timestamp`, `step_id`, `agent_id`, `payload`, `idempotency_key`).

---

## `POST /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents`

Link a Telnyx agent (AI assistant) to a run. `201 Created`.

**Source:** `execute.py` → `link_agent()`

### Request body (`LinkTelnyxAgentRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_agent_id` | string | **yes** | The Telnyx AI assistant ID to link. |

### Response — `201 Created` (`TelnyxAgentResponse`)

```json
{
  "data": {
    "run_id": "50d049a4-9b86-479c-a2ef-9c073edd47c2",
    "telnyx_agent_id": "assistant-3c35b300-27dc-461b-82f9-a32de7892b1d",
    "created_at": "2026-10-20T02:07:48.442940Z"
  }
}
```

---

## `GET /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents`

List linked agents. **Source:** `execute.py` → `list_linked_agents()`, `audit.py` → `_render()`. Response: `{"data": [<TelnyxAgentData>, ...]}` with fields `run_id`, `telnyx_agent_id`, `created_at`.

---

## Worker primitives: Assistants + Scheduled Events

These endpoints return the object **bare** (no `data` envelope).

### `POST /ai/assistants`

Create an assistant. `200 OK`. Minimal body: `{"name": ..., "instructions": ...}` — `model` and `voice` may be omitted, in which case the platform applies defaults (observed live: model `moonshotai/Kimi-K2.6`, a Telnyx.Ultra voice). The response object identifies the assistant by **`id`** (e.g. `assistant-3c35b300-...`).

**Source:** `execute.py` → `create_assistant()`

### `POST /ai/assistants/{assistant_id}/scheduled_events`

Schedule the outreach call. `201 Created`.

**Source:** `execute.py` → `create_scheduled_event()`

#### Request body (`CreateScheduledEventRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_conversation_channel` | string | **yes** | `phone_call` or `sms_chat`. |
| `telnyx_agent_target` | string | **yes** | The phone number (or SIP URI) the call is placed **from** — a number associated with the assistant. |
| `telnyx_end_user_target` | string | **yes** | The phone number the call is placed **to** (`DESTINATION_NUMBER`). |
| `scheduled_at_fixed_datetime` | string (ISO 8601) | **yes** | When the event fires; `execute.py` schedules it now. |
| `text` | string | no | Required for `sms_chat` events. |
| `conversation_metadata` | object | no | Free-form metadata. |
| `max_retries_client_errors` | integer | no | 0–10 retries on busy/no-answer/failed/canceled. |
| `retry_interval_secs` | integer | no | 60–86400. |

#### Response — `201 Created` (`ScheduledEventResponse`, bare)

```json
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": "+15550001234",
  "telnyx_agent_target": "+15550001234",
  "scheduled_at_fixed_datetime": "2026-10-20T02:07:47Z",
  "assistant_id": "assistant-3c35b300-...",
  "retry_count": 0,
  "retry_attempts": 0,
  "scheduled_event_id": "evt-...",
  "conversation_id": "...",
  "created_at": "2026-10-20T02:07:47.090116Z",
  "status": "pending",
  "errors": [],
  "call_status": null,
  "call_duration": null,
  "call_attempts": [
    {
      "attempt_number": 1,
      "attempted_at": "2026-10-20T02:08:10.000000Z",
      "call_status": "completed",
      "call_duration": 34,
      "telnyx_call_control_id": "v3:..."
    }
  ],
  "dispatched_at": "2026-10-20T02:08:10.000000Z",
  "call_settings": {"sip_region": "US"}
}
```

`telnyx_call_control_id` lives inside `call_attempts[]` entries (there is no top-level field) — the worker reads the latest attempt.

### `GET /ai/assistants/{assistant_id}/scheduled_events/{event_id}`

Poll one scheduled event. `200 OK` — same bare `ScheduledEventResponse`. `status` walks `pending` → `in_progress` → `completed` | `failed` (terminal). The worker polls every 5s with a 10-minute cap and mirrors every observed transition into the missions ledger.

**Source:** `execute.py` → `get_scheduled_event()`, `_poll_event()`

---

## Cleanup endpoints (not used by the demo, useful for hygiene)

- `DELETE /ai/missions/{mission_id}` — `204 No Content`; removes the mission (and its runs/plan/events view).
- `DELETE /ai/assistants/{assistant_id}` — `200 OK`; deletes the assistant.
- `DELETE /ai/assistants/{assistant_id}/scheduled_events/{event_id}` — cancels a `pending` event (or removes the record of a finished one).
