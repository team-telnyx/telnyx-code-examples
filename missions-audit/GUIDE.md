# Missions Audit Desk — A Guided Tour

This guide walks you through the `missions-audit` sample end to end: what each script does, which Telnyx primitives it calls, and how the pieces fit together to produce a forensic audit trail for one AI mission.

By the end you will have created a mission, started a run, planned three steps, executed the campaign, and rendered a chronological ledger showing **what was planned, what ran, and what failed**.

---

## 1. What you are building

The Missions API is Telnyx's orchestration layer for agent work. The pitch is simple: you get a complete audit trail without having to monitor the agent in real time. This sample is the accountability reference implementation — it drives one mission end to end and produces the ledger the docs promise.

The moving parts:

- **Mission** — the durable objective. It persists across runs.
- **Run** — one execution of a mission. It carries a `RunStatus`.
- **Plan** — the steps for a run. Each step has a status the executor advances.
- **Events** — typed log entries (`type` + `summary` + `payload`) that record what happened.
- **Telnyx agent linkage** — the assistant that did the work, linked to the run.

The **worker** (a Python script) does real work: it creates an assistant, creates a scheduled phone-call event, and watches that event reach terminal status. Its contract is honesty — it logs every state change it observes, not just its own actions, so the ledger is a record of the world rather than a self-report.

The **audit renderer** pulls mission, run, plan, events, and agent linkage into one chronological report.

---

## 2. Prerequisites

- Python 3.10 or newer.
- A Telnyx account with an API key.

That's all demo mode needs. For live mode you also need:

- A phone number associated with an AI Assistant in the Telnyx Portal (AI → Assistants → Phone Numbers). You will put that number in `ASSISTANT_PHONE_NUMBER`.
- A destination number you are willing to call.

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

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Bearer token for every API call. |
| `TELNYX_API_BASE` | no | Defaults to `https://api.telnyx.com/v2`. |
| `DEMO_MODE` | no | Defaults to `true`. See section 8. |
| `DESTINATION_NUMBER` | yes (live) | The number the outreach call targets (E.164). |
| `ASSISTANT_PHONE_NUMBER` | yes (live) | A phone number associated with the assistant in the Portal. |
| `ASSISTANT_ID` | no | Reuse an existing assistant instead of creating one (live mode). |
| `MISSION_ID` | no | Set after step 1 to avoid passing `--mission-id`. |
| `RUN_ID` | no | Set after step 2 to avoid passing `--run-id`. |

No secrets live in code. Every credential is read from the environment via `dotenv`.

---

## 4. The workflow, script by script

The acceptance criteria mandate standalone CLI scripts, one per workflow step. `app.py` is only a thin dispatcher that prints the menu — it does no work itself.

### Step 1 — `create_mission.py`

Creates the durable objective and then lists recent missions so you can see the resource shape.

```bash
python create_mission.py
# or: python create_mission.py --name "Clinic outreach audit" --description "Verify 3 clinic contacts can be reached"
```

Under the hood it calls `POST /ai/missions` with `{"name", "description", "instructions", "execution_mode": "external"}` and then `GET /ai/missions?page[size]=5`. The API **requires `name`** — the objective text goes in `description`. Responses are wrapped in the `{"data": ...}` envelope and the mission is identified by `mission_id`.

The script prints the new `mission_id` and suggests the next command.

### Step 2 — `start_run.py`

Starts one execution of the mission.

```bash
python start_run.py --mission-id <mission_id>
```

It calls `POST /ai/missions/{mission_id}/runs` with an empty body and prints the `run_id` plus the initial status, which is `pending`. It then lists all runs for the mission via `GET /ai/missions/{mission_id}/runs`.

`RunStatus` values are `pending`, `running`, `paused`, `succeeded`, `failed`, `cancelled`. The demo walks `pending` → `running` → `succeeded` (or `failed`); `paused` and `cancelled` are documented in the state table that `audit.py` prints, and have dedicated endpoints (`POST .../runs/{run_id}/pause`, `/resume`, `/cancel`).

### Step 3 — `plan_steps.py`

Submits the initial plan: three steps for the call campaign.

```bash
python plan_steps.py --mission-id <mission_id> --run-id <run_id>
```

The plan is defined at module level in `plan_steps.py`. Each step carries a client-chosen `step_id`, a `description`, and a `sequence` (all required — the API has no separate `name` field for steps):

1. **`provision_assistant`** — create the clinic outreach assistant.
2. **`schedule_outreach_call`** — create one scheduled phone-call event.
3. **`verify_outcome`** — confirm the scheduled event reached terminal status.

It calls `POST /ai/missions/{mission_id}/runs/{run_id}/plan` with `{"steps": [...]}` and prints each returned `step_id` with its status, which starts as `pending`. If a plan already exists on the run, the script shows it instead of resubmitting.

Step statuses are `pending`, `in_progress`, `completed`, `skipped`, `failed`. The demo walks each step `pending` → `in_progress` → `completed` (or `failed` on worker error). `skipped` is documented but unused.

### Step 4 — `execute.py`

This is the worker. It runs the campaign and records the audit trail.

```bash
python execute.py --mission-id <mission_id> --run-id <run_id>
```

**In demo mode (`DEMO_MODE=true`, the default)** the worker walks all three steps `pending` → `in_progress` → `completed` with simulated work — no assistant is created, no call is placed, no agent is linked — and the run finishes `succeeded` with a `result_summary` saying exactly that. This exercises every ledger mechanic safely.

**In live mode (`DEMO_MODE=false`)** the flow is:

1. Fetch the three planned steps. If fewer than three exist, it tells you to run `plan_steps.py` first.
2. Mark the run `running` via `PATCH /ai/missions/{mission_id}/runs/{run_id}`.
3. Create the assistant via `POST /ai/assistants`. If `ASSISTANT_ID` is set in the environment it reuses that; otherwise it creates one with the fixed clinic-outreach instructions (model and voice omitted, so the platform defaults apply — observed live: model `moonshotai/Kimi-K2.6`, a Telnyx Ultra voice). **Note the bare response: the assistant id is at `id`, not inside a `data` envelope.**
4. For each step, `_run_step` advances the step `pending` → `in_progress`, logs a `step_started` event, runs the work, then advances to `completed` and logs `step_completed` — or advances to `failed` and logs `step_failed` with the error in `payload`.
5. Step 2 creates the scheduled event via `POST /v2/ai/assistants/{assistant_id}/scheduled_events`. All four fields are required: `telnyx_conversation_channel` (`phone_call`), `telnyx_agent_target` (your `ASSISTANT_PHONE_NUMBER`), `telnyx_end_user_target` (the destination), and `scheduled_at_fixed_datetime`. If `ASSISTANT_PHONE_NUMBER` is unset the script exits with an actionable error listing the Portal step. `DESTINATION_NUMBER` is validated as E.164 before use.
6. After the event is created, `_poll_event` polls `GET /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` every 5 seconds, with a hard cap of 10 minutes. Every observed status change is printed **and mirrored as a `status_change` missions event**. Terminal statuses are `completed` and `failed`.
7. Once terminal, the worker logs one `custom` event with `payload` `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}` — mirroring the scheduled-event `call_attempts` entry shape (`telnyx_call_control_id` lives inside the attempts array).
8. Step 3 verifies the outcome. If the scheduled event ended `failed`, the step fails and the run is marked `failed` with a `result_summary` naming the failing step and the platform's `call_status`.
9. If polling times out or the poll request errors, the worker logs an `error` event and fails the **verify** step with the worker-side reason ("verification timed out after 600s; last observed status: X") — it never records a fabricated call failure.
10. Finally the worker links the assistant to the run via `POST /ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` with body `{"telnyx_agent_id": "<assistant_id>"}`, then calls `GET .../runs/{run_id}/telnyx-agents` and prints the linkage rows. A linkage failure is recorded as an `error` event but does not fail the campaign.

**The honesty contract.** Every state change the worker observes — including the platform's own scheduled-event status transitions — is mirrored as a missions event. The ledger records the world, not just the worker's self-report. A poll timeout is logged as an `error` event, not as a call failure. This one discipline is what makes the trail trustworthy.

### Step 5 — `audit.py`

Waits for the run to reach a terminal status and renders the report.

```bash
python audit.py --mission-id <mission_id> --run-id <run_id>
# or: python audit.py --mission-id <m> --run-id <r> --nowait
```

It polls `GET /ai/missions/{mission_id}/runs/{run_id}` every 5 seconds until `RunStatus` is `succeeded`, `failed`, or `cancelled` (hard cap 10 minutes; `--nowait` skips the wait). Then it does a **fresh `GET`** before rendering — the report reflects the server's current state, not a cached one.

The report includes:

- **Mission and run** — ids, name/description, final status, `result_summary`, `result_payload`, `error`, timestamps.
- **Steps table** — planned versus completed, one row per step with `sequence`, `step_id`, `status`, `completed_at`, and description.
- **Event timeline** — every event sorted by `timestamp`, showing `type`, `step_id`, `summary`, and `payload`.
- **Linked Telnyx agents** — `run_id`, `telnyx_agent_id`, `created_at` for each linkage row.
- **State tables** — the full `RunStatus` and `StepStatus` enums with descriptions.

The script exits `0` if the run reached a terminal status, `1` otherwise (it warns explicitly if the poll cap was hit).

### `app.py` — the dispatcher

`app.py` prints the workflow menu and points you at the right script. It does no API work.

```bash
python app.py --list
```

The `WORKFLOW` list at the top of the file is the single source of truth for the script order, and `smoke_test.py` asserts that all five workflow scripts appear in it.

---

## 5. Running the whole thing

```bash
python create_mission.py
# copy the printed mission_id

python start_run.py --mission-id <mission_id>
# copy the printed run_id

python plan_steps.py --mission-id <mission_id> --run-id <run_id>
python execute.py    --mission-id <mission_id> --run-id <run_id>
python audit.py      --mission-id <mission_id> --run-id <run_id>
```

To avoid repeating the ids, export them:

```bash
export MISSION_ID=<mission_id>
export RUN_ID=<run_id>
```

Every script falls back to those environment variables when the corresponding flag is omitted.

---

## 6. Reading the audit report

A successful demo-mode run looks roughly like this:

```
MISSIONS AUDIT REPORT
-- Mission --
mission_id     : mis-...
name           : Clinic outreach audit
description    : Verify 3 clinic contacts can be reached
execution_mode : external

-- Run --
run_id         : 50d049a4-...
status         : succeeded
result_summary : Demo mode: missions ledger walked end-to-end; no assistant created and no call placed (DEMO_MODE=true).

-- Steps (planned vs completed) --
seq  step_id                    status       completed_at          description
1    provision_assistant        completed    2026-10-20T02:1...    Provision assistant - create the clinic...
2    schedule_outreach_call     completed    2026-10-20T02:1...    Schedule outreach call - create one...
3    verify_outcome             completed    2026-10-20T02:1...    Verify outcome - confirm the scheduled...

-- Event timeline --
2026-10-20T02:11:01.500Z   step_started    provision_assistant    Step provision_assistant started
2026-10-20T02:11:02.100Z   step_completed  provision_assistant    Step provision_assistant completed
...

-- Linked Telnyx agents --
(none - demo mode performs no linkage)
```

In live mode the timeline additionally shows `status_change` rows for every observed scheduled-event transition and one `custom` row per call attempt.

The event timeline is the forensic record. Because the worker mirrors observed platform state as events, you can replay the run from the ledger alone: what was planned (the steps), what ran (the `step_started` / `step_completed` pairs), and what failed (a `step_failed` event with the error in `payload`, plus a run `result_summary` naming the step).

---

## 7. Failure handling

If the scheduled event ends `failed` (live mode), the worker:

1. Logs the `custom` call-attempt event with the platform's `call_status`.
2. Fails step 3 (`verify_outcome`) with a `step_failed` event whose `payload.error` reads `scheduled event ended as failed (call_status: ...)`.
3. Marks the run `failed` with `result_summary` naming step 3 and the cause.

`audit.py` then renders the same report with `status: failed` and the failing step visible in the steps table. Nothing is swallowed — the error surfaces in three places: the step status, the event timeline, and the run summary.

If step 1 or step 2 raises, the run is marked `failed` with a summary naming that step, and `execute.py` exits `1`.

A poll timeout is **not** treated as a call failure: the worker logs an `error` event (`reason: poll_timeout`), fails the verify step with the worker-side reason, and marks the run `failed` — the ledger distinguishes "the call failed" from "we could not observe the call".

Transient API failures (HTTP 429/5xx, network blips) are retried with exponential backoff (2s, 4s, 8s, 16s — five attempts total). If the worker still dies unexpectedly, it records a `worker_crashed` `error` event and marks the run `failed` before exiting, so the ledger is never left silently `running`.

---

## 8. Demo mode versus live mode

`DEMO_MODE` defaults to `true`. In demo mode the worker walks the ledger with no side effects beyond missions objects:

```
[DEMO] DEMO_MODE=true - walking the missions ledger with no side effects.
[DEMO] ledger walked end-to-end - no assistant created, no call placed.
```

To place real calls, set:

```bash
DEMO_MODE=false
```

and make sure `DESTINATION_NUMBER` and `ASSISTANT_PHONE_NUMBER` are real, reachable numbers. Phone numbers are always masked in console output via the `_mask` helper — you will never see a full number in the console output.

---

## 9. Testing

```bash
pytest smoke_test.py
```

The smoke test imports every workflow module and asserts each exposes a callable `_main`. It also asserts that `app.WORKFLOW` lists all five workflow scripts and that `app._main(["--list"])` returns `0` without side effects, that the 3-step plan carries valid `step_id`/`description`/`sequence` values, that `_mask` hides numbers, that the E.164 regex behaves, and that the `RunStatus`/`StepStatus` tables cover the full API enums. No network calls are made.

---

## 10. Next steps

- [Voice outreach with AI missions](https://developers.telnyx.com/docs/inference/missions) — the conceptual overview.
- [Missions API reference index](https://developers.telnyx.com/api-reference/missions) — every endpoint used here.
- [Create mission](https://developers.telnyx.com/api-reference/missions/create-mission)
- [Start a run](https://developers.telnyx.com/api-reference/missions/start-a-run)
- [List runs for mission](https://developers.telnyx.com/api-reference/missions/list-runs-for-mission)
- [Create initial plan](https://developers.telnyx.com/api-reference/missions/create-initial-plan)
- [Update run](https://developers.telnyx.com/api-reference/missions/update-run)
- [Update step status](https://developers.telnyx.com/api-reference/missions/update-step-status)
- [Log event](https://developers.telnyx.com/api-reference/missions/log-event)
- [List linked Telnyx agents](https://developers.telnyx.com/api-reference/missions/list-linked-telnyx-agents)

To extend the sample: loop the three-step plan once per contact to build a multi-contact campaign, or exercise the `paused` transition via `POST /ai/missions/{mission_id}/runs/{run_id}/pause` and `/resume` between steps.
