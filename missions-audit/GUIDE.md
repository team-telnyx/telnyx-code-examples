# Missions Audit Desk — A Guided Tour

This guide walks you through the `missions-audit` sample end-to-end. By the end you will have created a Telnyx **AI Mission**, started a **run**, planned **steps**, executed a small outreach campaign, logged typed **events**, linked an **assistant** to the run, and rendered a full **audit report** — the "what was planned, what was done, what failed" ledger.

The sample is a Flask app (`app.py`) that exposes the whole flow as HTTP endpoints. Each endpoint maps 1:1 to a step in the ticket's CLI flow (`create_mission.py`, `start_run.py`, `plan_steps.py`, `execute.py`, `audit.py`).

---

## 1. What you are building

A **Missions Audit Desk**: a small loop around one durable objective.

- The **mission** is the durable objective — it persists across runs.
- A **run** is one execution of that mission.
- Each run carries **steps** whose statuses the worker advances as work happens.
- The **worker** (the `/execute` endpoint) does real work: creates an assistant, creates a scheduled phone-call event, watches it reach terminal status.
- The **audit renderer** (`/missions/audit/...`) pulls run detail, steps, events, and agent linkage into one chronological report.

One discipline makes the trail trustworthy: **every state change the worker observes is mirrored as a missions event**, so the ledger records the platform's responses too, not just the worker's own actions.

---

## 2. Prerequisites

- Python 3.9+
- A Telnyx account with an API key
- A phone number associated with an AI Assistant in the Telnyx portal (for live mode)
- `curl` (or any HTTP client) to drive the endpoints

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TELNYX_API_KEY` | yes | — | Your Telnyx API key. The app refuses to start without it. |
| `DEMO_MODE` | no | `true` | When `true`, no real calls are placed. Set to `false` for live mode. |
| `DESTINATION_NUMBER` | live | `+1555XXXXXXXX` | The end-user number the outreach call targets. |
| `ASSISTANT_PHONE_NUMBER` | live | — | A phone number associated with the assistant in the portal. Required in live mode. |
| `ASSISTANT_ID` | no | — | Reuse an existing assistant instead of creating one. |
| `POLL_INTERVAL_SECONDS` | no | `5` | How often the worker polls the scheduled event. |
| `POLL_TIMEOUT_SECONDS` | no | `600` | Hard cap on polling (10 minutes). |
| `PORT` | no | `5000` | Flask listen port. |

The app loads these via `dotenv` at the top of `app.py` (the `load_dotenv()` call and the `API_KEY` guard immediately after). **No credentials live in code** — everything comes from the environment.

---

## 4. Demo mode vs live mode

This is the most important switch in the sample.

**Demo mode (`DEMO_MODE=true`, the default)** — the worker simulates the scheduled call. It logs what *would* happen (with the destination number masked), fabricates a `demo-event` with status `completed`, and skips the polling loop. No real calls are placed, no charges are incurred. This is safe to run anywhere.

**Live mode (`DEMO_MODE=false`)** — the worker creates a real assistant (unless `ASSISTANT_ID` is set), creates a real scheduled phone-call event via `POST /v2/ai/assistants/{assistant_id}/scheduled_events`, and polls it every `POLL_INTERVAL_SECONDS` until it reaches a terminal status (`completed` or `failed`) or the `POLL_TIMEOUT_SECONDS` cap is hit.

To switch, edit `.env`:

```bash
DEMO_MODE=false
DESTINATION_NUMBER=+15551234567
ASSISTANT_PHONE_NUMBER=+15559876543
```

If `ASSISTANT_PHONE_NUMBER` is unset in live mode, the worker raises an actionable error telling you to associate a number with the assistant in the portal first.

---

## 5. Running the app

```bash
python app.py
```

You should see Flask start on port 5000. Confirm it's healthy:

```bash
curl http://localhost:5000/health
# {"status": "ok", "demo_mode": true}
```

---

## 6. The demo flow, step by step

### Step 1 — Create the mission

`POST /missions` maps to `create_mission.py`. It calls `POST /ai/missions` to create the mission, then `GET /ai/missions` to list missions and show the resource shape.

```bash
curl -X POST http://localhost:5000/missions \
  -H 'Content-Type: application/json' \
  -d '{"objective": "Verify 3 clinic contacts can be reached"}'
```

The response contains the new `mission` object and the `missions` list. Note the `mission.id` — you'll need it for every subsequent call.

**Code reference:** the `create_mission()` route handler in `app.py`. It validates that `objective` is non-empty, calls `_missions().create(...)` and `_missions().list()`, and returns both.

### Step 2 — Start a run

`POST /missions/<mission_id>/runs` maps to `start_run.py`. It calls `POST /ai/missions/{mission_id}/runs` and returns the run plus its initial status (`pending`).

```bash
curl -X POST http://localhost:5000/missions/<MISSION_ID>/runs
```

**Code reference:** the `start_run()` route handler. It calls `_missions().runs.create(mission_id=...)` and echoes back `run.get("status", "pending")`.

### Step 3 — Plan the steps

`POST /missions/<mission_id>/runs/<run_id>/steps` maps to `plan_steps.py`. It submits the initial plan — three steps by default:

1. `provision assistant`
2. `schedule outreach call`
3. `verify outcome`

```bash
curl -X POST http://localhost:5000/missions/<MISSION_ID>/runs/<RUN_ID>/steps \
  -H 'Content-Type: application/json' \
  -d '{}'
```

The response includes `step_ids` — an ordered list of the three step IDs. **Save these**; the execute endpoint requires exactly three.

You can override the plan by passing your own `steps` array in the body.

**Code reference:** the `plan_steps()` route handler. It calls `_missions().runs.steps.create(...)` and extracts `step_ids` from the returned plan.

### Step 4 — Execute the campaign

`POST /missions/<mission_id>/runs/<run_id>/execute` maps to `execute.py`. This is the worker. It walks each step `pending → in_progress → completed` (or `failed` on error) and logs a typed event at every transition.

```bash
curl -X POST http://localhost:5000/missions/<MISSION_ID>/runs/<RUN_ID>/execute \
  -H 'Content-Type: application/json' \
  -d '{"step_ids": ["<STEP1>", "<STEP2>", "<STEP3>"]}'
```

Here's what happens inside, in order:

**Step 1 — provision assistant.** The worker advances step 1 to `in_progress`, logs a `step_started` event, creates the assistant (or reuses `ASSISTANT_ID`), advances step 1 to `completed`, and logs a `step_completed` event carrying the `assistant_id`.

**Step 2 — schedule outreach call.** The worker advances step 2 to `in_progress`, logs `step_started`, creates the scheduled event (or fabricates a demo event in demo mode), logs a **`custom`** event with properties `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}` mirroring the scheduled-event `call_attempts` entry shape, advances step 2 to `completed`, and logs `step_completed`.

**Step 3 — verify outcome.** The worker advances step 3 to `in_progress`, logs `step_started`, then polls the scheduled event to terminal status (live mode) or assumes `completed` (demo mode). Every observed status change is mirrored as a `status_change` event — this is the honesty contract.

If the call failed, the worker advances step 3 to `failed`, logs a `step_failed` event, and calls `PATCH /ai/missions/{mission_id}/runs/{run_id}` with `status="failed"`, a `result_summary` describing the failure, and a `result_payload` carrying the failing step ID. On success it marks the run `succeeded` with a summary.

Finally, the worker links the assistant to the run via `POST .../runs/{run_id}/telnyx-agents` with body `{"telnyx_agent_id": "<assistant_id>"}`, then calls `GET .../runs/{run_id}/telnyx-agents` to list the linkage rows.

**Code reference:** the `execute()` route handler plus the helpers `_advance_step()`, `_log_event()`, `_create_assistant()`, `_create_scheduled_event()`, and `_poll_scheduled_event()`.

### Step 5 — Render the audit report

`GET /missions/audit/<mission_id>/<run_id>` maps to `audit.py`. It fetches the mission, run, steps, events, and linked agents, then renders the full ledger.

```bash
curl http://localhost:5000/missions/audit/<MISSION_ID>/<RUN_ID>
```

The report contains:

- **`mission`** — id and objective
- **`run`** — id, status, `result_summary`, `result_payload`
- **`steps`** — a per-step planned-versus-completed table (`planned_status` is always `pending`; `current_status` is the live value; `completed` is a boolean)
- **`events`** — the full event timeline with `event_type` and `properties`, each timestamped
- **`linked_agents`** — the linkage rows (`run_id`, `telnyx_agent_id`, `created_at`)
- **`run_status_enum`**, **`step_status_enum`**, **`event_type_enum`** — the full enums, printed so the report is self-describing

**Code reference:** the `audit()` route handler. It calls `_missions().retrieve(...)`, `_missions().runs.retrieve(...)`, `_missions().runs.steps.list(...)`, `_missions().runs.events.list(...)`, and `_missions().runs.telnyx_agents.list(...)`, then normalizes each into flat rows.

---

## 7. The enums, in full

These are the API enums the sample walks. The audit report prints all three.

**RunStatus** — `pending`, `running`, `paused`, `succeeded`, `failed`, `cancelled`. The demo walks `pending → running → succeeded` (or `failed`). `paused` and `cancelled` are documented but unused.

**Step status** — `pending`, `in_progress`, `completed`, `skipped`, `failed`. The demo walks `pending → in_progress → completed` (or `failed`). `skipped` is documented but unused.

**EventType** — `status_change`, `step_started`, `step_completed`, `step_failed`, `tool_call`, `tool_result`, `message`, `error`, `custom`. The worker logs `step_started` / `step_completed` / `step_failed` per step transition, plus one `custom` event per call attempt.

---

## 8. The linked-agents response shape

`GET /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` returns rows with exactly three fields:

- `run_id` — the run the agent is linked to
- `telnyx_agent_id` — the assistant ID
- `created_at` — when the linkage was created

The audit report surfaces all three per row.

---

## 9. Failure handling

If the scheduled call fails, the worker:

1. Advances step 3 to `failed`
2. Logs a `step_failed` event with the `call_status`
3. Calls `PATCH /ai/missions/{mission_id}/runs/{run_id}` with `status="failed"`, `result_summary="scheduled outreach call failed"`, and `result_payload={"failing_step_id": step3, "call_status": call_status}`

The audit report then shows the failing step in the steps table and the failure in the run's `result_summary` / `result_payload`. This is the acceptance criterion: **worker failures are surfaced, and the audit trail shows the failing step.**

---

## 10. Security notes

- All credentials come from the environment via `dotenv`. Nothing is hardcoded.
- Phone numbers are masked in logs via the `_mask()` helper — you'll never see a full number in the console.
- Error responses are generic (`"failed to create mission"`, `"execution failed"`); exception details go to `app.logger.exception(...)`, not to the HTTP response.

---

## 11. Next steps

- [Voice outreach with AI missions](https://developers.telnyx.com/docs/inference/missions) — the conceptual overview
- [Missions API reference index](https://developers.telnyx.com/api-reference/missions) — every endpoint
- [Create mission](https://developers.telnyx.com/api-reference/missions/create-mission)
- [Start a run](https://developers.telnyx.com/api-reference/missions/start-a-run)
- [List runs for mission](https://developers.telnyx.com/api-reference/missions/list-runs-for-mission)
- [Create initial plan](https://developers.telnyx.com/api-reference/missions/create-initial-plan)
- [Update run](https://developers.telnyx.com/api-reference/missions/update-run)
- [Update step status](https://developers.telnyx.com/api-reference/missions/update-step-status)
- [Log event](https://developers.telnyx.com/api-reference/missions/log-event)
- [List linked Telnyx agents](https://developers.telnyx.com/api-reference/missions/list-linked-telnyx-agents)

To extend the sample: loop the plan for multiple contacts (the "3 contacts" objective is a string only — the demo places one call to keep the ledger focused on the trail mechanics), add `paused` / `cancelled` transitions via `PATCH /ai/missions/{mission_id}/runs/{run_id}`, or wire the audit report into a dashboard.
