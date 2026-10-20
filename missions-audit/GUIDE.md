# Missions Audit Desk — Developer Guide

A step-by-step walkthrough of the `missions-audit` sample: how it plans a Telnyx AI Mission, runs it, and produces a forensic audit trail you can replay afterwards.

This guide explains **why** each script exists, **what** Telnyx primitives it touches, and **how** the pieces compose into a trustworthy ledger. Read it top-to-bottom the first time; afterwards use it as a reference.

---

## Table of contents

1. [What you're building](#what-youre-building)
2. [Prerequisites](#prerequisites)
3. [Environment setup](#environment-setup)
4. [Demo mode vs live mode](#demo-mode-vs-live-mode)
5. [The five-script workflow](#the-five-script-workflow)
6. [Walking through the code](#walking-through-the-code)
   - [app.py — the dispatcher](#apppy--the-dispatcher)
   - [create_mission.py — the durable objective](#create_missionpy--the-durable-objective)
   - [start_run.py — one execution of the objective](#start_runpy--one-execution-of-the-objective)
   - [plan_steps.py — the initial plan](#plan_stepspy--the-initial-plan)
   - [execute.py — the worker and its honesty contract](#executepy--the-worker-and-its-honesty-contract)
   - [audit.py — the forensic report](#auditpy--the-forensic-report)
7. [The audit trail contract](#the-audit-trail-contract)
8. [State tables](#state-tables)
9. [Running the smoke test](#running-the-smoke-test)
10. [Troubleshooting](#troubleshooting)
11. [Next steps](#next-steps)

---

## What you're building

The Telnyx **AI Missions** API is the orchestration layer that makes agent work auditable. The docs pitch it as: *"you get a complete audit trail without having to monitor the agent in real time."* But the raw Missions endpoints — create, plan, run, step, event, link — have almost no sample coverage. This sample is the accountability reference implementation.

You'll drive **one** mission end-to-end:

- A **mission** is the durable objective (e.g. *"Verify 3 clinic contacts can be reached"*). It persists across runs.
- A **run** is one execution of that mission. It carries `RunStatus` (`pending` → `running` → `succeeded` / `failed`).
- **Steps** are the plan for a run. Each step walks `pending` → `in_progress` → `completed` (or `failed`).
- **Events** are typed log entries (`EventType` + `properties`) that record what happened, in order.
- A **linked Telnyx agent** (an AI Assistant) is attached to the run so you can see which assistant did the work.

The worker in this sample is a Python script that creates an AI Assistant, schedules one phone-call event, watches it reach terminal status, and mirrors every observed state change back into the missions ledger. The audit renderer then pulls it all together into one chronological report.

> **A note on the word "agent".** In this sample, "agent" means a **Telnyx AI Assistant** driven via scheduled events — not the Edge Agent SDK. No TypeScript runtime is involved.

---

## Prerequisites

- **Python 3.10+** (the scripts use `from __future__ import annotations` and modern typing).
- A **Telnyx account** with API access.
- A **Telnyx API key** — create one in the [Telnyx Portal](https://portal.telnyx.com).
- For live mode: a **phone number associated with your AI Assistant**. You'll set this up in the Portal under **AI → Assistants → Phone Numbers**. The sample exits with an actionable error if it's missing.

Install dependencies:

```bash
pip install -r requirements.txt
```

The `requirements.txt` pulls in the Telnyx Python SDK and `python-dotenv`.

---

## Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

The sample reads these variables:

| Variable | Required | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | always | Authenticates every SDK call. |
| `DEMO_MODE` | no (default `true`) | When `true`, no real calls are placed. |
| `DESTINATION_NUMBER` | live mode | The number the assistant calls. |
| `ASSISTANT_PHONE_NUMBER` | live mode | A phone number associated with your assistant (the `telnyx_agent_target`). |
| `ASSISTANT_ID` | no | Reuse an existing assistant instead of creating one. |
| `MISSION_ID` | after step 1 | Set by you (or passed via `--mission-id`) so later scripts find the mission. |
| `RUN_ID` | after step 2 | Same idea, for the run. |
| `STEP_IDS` | after step 3 | Comma-separated step IDs from the plan. |

**Never commit `.env`.** It's in `.gitignore`. `.env.example` contains placeholders only.

---

## Demo mode vs live mode

The sample ships in **safe demo mode** by default. `DEMO_MODE=true` means:

- No scheduled phone-call event is created.
- The worker prints `[DEMO] would schedule call to ... from ...` and uses a placeholder event ID.
- The step transitions, event logs, run status update, and agent linkage **all still execute** — so the audit trail is fully populated and the mechanics are exercised end-to-end.

To switch to **live mode**, set `DEMO_MODE=false` in `.env` and make sure `DESTINATION_NUMBER` and `ASSISTANT_PHONE_NUMBER` are set. In live mode the worker:

1. Creates a real scheduled phone-call event via `POST /v2/ai/assistants/{assistant_id}/scheduled_events`.
2. Polls `GET /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` every 5 seconds (hard cap 10 minutes) until the event reaches `completed` or `failed`.
3. Mirrors the terminal status into the missions ledger.

The audit report looks identical in both modes — that's the point. The ledger mechanics are what you're evaluating.

---

## The five-script workflow

The acceptance criteria mandate standalone CLI scripts. Run them in order:

```bash
# 1. Create the mission
python create_mission.py --objective "Verify 3 clinic contacts can be reached"

# 2. Start a run for that mission
python start_run.py --mission-id <MISSION_ID>

# 3. Submit the initial 3-step plan
python plan_steps.py --mission-id <MISSION_ID> --run-id <RUN_ID>

# 4. Execute the campaign (advance steps, log events, link the assistant)
python execute.py --mission-id <MISSION_ID> --run-id <RUN_ID> --step-ids <ID1,ID2,ID3>

# 5. Render the forensic audit report
python audit.py --mission-id <MISSION_ID> --run-id <RUN_ID>
```

Each script also reads its arguments from `.env` (`MISSION_ID`, `RUN_ID`, `STEP_IDS`), so once you've run step 1 you can paste the ID into `.env` and drop the flags.

`app.py` is a thin help-dispatcher — run `python app.py` to print the workflow order and each script's `--help` hint.

---

## Walking through the code

### `app.py` — the dispatcher

`app.py` is deliberately thin. It defines a `WORKFLOW` list of `(script, description)` tuples and prints them. There is no business logic here — the workflow lives in the five named scripts. This keeps each step independently runnable and independently testable.

The `_main()` function parses no arguments beyond `--help` and returns `0`. The smoke test asserts that every script in `WORKFLOW` is importable and exposes `_main()`.

### `create_mission.py` — the durable objective

This is the entry point. It calls:

```python
client.post("/ai/missions", body={"objective": objective})
```

The response carries the `mission_id` (the script accepts either `id` or `mission_id` in the payload, since the API has used both shapes). It then calls `GET /ai/missions` to list missions and print the resource shape — useful for confirming your account sees the new mission.

The default objective is `"Verify 3 clinic contacts can be reached"`. Note: the "3 contacts" is the **objective string only**. The demo places **one** call — the 3-step plan executes once, keeping the audit ledger focused on the trail mechanics. See the README for how to loop the plan for multiple contacts.

**Primitives used:** `POST /ai/missions`, `GET /ai/missions`.

### `start_run.py` — one execution of the objective

A mission is durable; a run is one execution of it. This script calls:

```python
client.post(f"/ai/missions/{mission_id}/runs", body={})
```

The response carries the `run_id` and an initial `status` of `pending`. The script prints both and reminds you to run `plan_steps.py` next.

**Primitives used:** `POST /ai/missions/{mission_id}/runs`.

### `plan_steps.py` — the initial plan

The plan is submitted as a single call:

```python
client.post(
    f"/ai/missions/{mission_id}/runs/{run_id}/steps",
    body={"steps": PLAN},
)
```

`PLAN` is a module-level list of three steps:

1. `provision assistant` — create the clinic outreach assistant.
2. `schedule outreach call` — schedule one phone-call event.
3. `verify outcome` — confirm the call reached terminal status.

The response returns the created steps with their IDs and an initial `status` of `pending`. The script prints each step ID — you'll pass these to `execute.py` as a comma-separated list (`--step-ids`).

**Primitives used:** `POST /ai/missions/{mission_id}/runs/{run_id}/steps`.

### `execute.py` — the worker and its honesty contract

This is the heart of the sample. It performs the real work and, crucially, **mirrors every state change it observes** back into the missions ledger. That discipline is what makes the trail trustworthy: the ledger records the platform's responses, not just the worker's self-report.

The script is organized around three helper functions:

- `_patch_step(client, mission_id, run_id, step_id, status)` — advances a step's status via `PATCH .../steps/{step_id}`.
- `_log_event(client, mission_id, run_id, event_type, properties)` — logs a typed event via `POST .../events`.
- `_create_assistant(client)` — reuses `ASSISTANT_ID` if set, otherwise creates a new assistant via `POST /ai/assistants` with the clinic-outreach instructions. Model and voice are omitted on create, so the platform defaults apply.

The main flow walks each step `pending → in_progress → completed`:

**Step 1 — provision assistant.** Patch the step to `in_progress`, log a `step_started` event with `{"step_id", "step_name"}`, create the assistant, patch to `completed`, log `step_completed`.

**Step 2 — schedule outreach call.** Patch to `in_progress`, log `step_started`. In demo mode, print the would-be call and use a placeholder event ID. In live mode, call `_schedule_call`, which posts to `/ai/assistants/{assistant_id}/scheduled_events` with:

```python
{
    "event_type": "phone_call",
    "telnyx_agent_target": target,        # ASSISTANT_PHONE_NUMBER
    "telnyx_end_user_target": destination, # DESTINATION_NUMBER
}
```

**Step 3 — verify outcome.** Patch to `in_progress`, log `step_started`. In live mode, `_poll_event` polls the scheduled event every 5 seconds (hard cap 10 minutes) until it reaches `completed` or `failed`. Every observed status change is printed — and the terminal status is mirrored as a `custom` event with properties:

```python
{
    "scheduled_event_id": event_id,
    "call_status": final_status,
    "telnyx_call_control_id": None,
    "attempt_number": 1,
}
```

This shape mirrors the scheduled-event `call_attempts` entry, so a reviewer can correlate the two records.

**Terminal handling.** If the event completed, patch step 3 to `completed`, log `step_completed`, and `PATCH` the run to `succeeded` with a `result_summary`. If it failed, patch step 3 to `failed`, log `step_failed`, and `PATCH` the run to `failed` with a `result_summary` naming the failing event. This is how worker failures surface in the audit trail.

**Linking the assistant.** Finally, the script links the assistant to the run:

```python
client.post(
    f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
    body={"telnyx_agent_id": assistant_id},
)
```

Then it calls `GET .../runs/{run_id}/telnyx-agents` and prints the linkage rows (`run_id`, `telnyx_agent_id`, `created_at`).

**Primitives used:** `PATCH .../steps/{step_id}`, `POST .../events`, `POST /ai/assistants`, `POST /ai/assistants/{id}/scheduled_events`, `GET /ai/assistants/{id}/scheduled_events/{event_id}`, `PATCH .../runs/{run_id}`, `POST .../telnyx-agents`, `GET .../telnyx-agents`.

### `audit.py` — the forensic report

The audit renderer waits for the run to reach a terminal status, then fetches everything fresh and prints the ledger.

`_wait_for_terminal` polls `GET .../runs/{run_id}` every 5 seconds (hard cap 10 minutes) until `status` is in `{"succeeded", "failed", "cancelled"}`.

Before rendering, the script **cross-checks against fresh GETs** — it re-fetches the mission, run, steps, events, and linked agents. This guarantees the report reflects the server's current state, not a stale local cache. The acceptance criteria call this out explicitly: *"the script cross-checks against a fresh `GET` before rendering."*

`_render` prints, in order:

1. **Mission** — ID, status, objective.
2. **Run** — ID, status, `result_summary`, `result_payload`.
3. **Steps** — a planned-vs-completed table with `step_id`, `name`, `status`, `updated_at`.
4. **Event timeline** — every event with its `created_at`, `event_type`, and `properties`.
5. **Linked Telnyx agents** — `run_id`, `telnyx_agent_id`, `created_at`.
6. **RunStatus state table** — the full enum with descriptions.

That's the exact *"what was planned, what was done, what failed"* ledger the docs promise.

**Primitives used:** `GET /ai/missions/{id}`, `GET .../runs/{run_id}`, `GET .../steps`, `GET .../events`, `GET .../telnyx-agents`.

---

## The audit trail contract

One discipline makes the trail trustworthy, and it's worth stating plainly:

> **Every state change the worker observes is mirrored as a missions event.**

When the scheduled event transitions from `pending` to `in_progress` to `completed`, the worker logs a missions event for each transition it observes. When it creates the assistant, it logs `step_started` and `step_completed`. When it links the agent, the linkage row is fetched and printed.

The result is a ledger that records **the platform's responses**, not just the worker's actions. A reviewer replaying the trail sees:

- What was **planned** (the three steps from `plan_steps.py`).
- What **ran** (the `step_started` / `step_completed` events with timestamps).
- What **failed** (the `step_failed` event and the run's `result_summary`).
- Which **assistant** did the work (the linked-agent row).

This is why the sample exists: to show the ledger mechanics, not the Portal demo.

---

## State tables

### RunStatus

| Status | Meaning |
|---|---|
| `pending` | Run created, not yet started. |
| `running` | Run is executing steps. |
| `paused` | Run paused by operator (`PATCH update-run`). |
| `succeeded` | Run completed successfully. |
| `failed` | Run failed; see `result_summary`. |
| `cancelled` | Run cancelled by operator. |

The demo walks `pending` → `running` → `succeeded` (or `failed`). `paused` and `cancelled` are documented here and printed by `audit.py`, but not exercised by the demo flow.

### Step status

| Status | Meaning |
|---|---|
| `pending` | Step planned, not started. |
| `in_progress` | Step is executing. |
| `completed` | Step finished successfully. |
| `skipped` | Step intentionally skipped. |
| `failed` | Step failed. |

The demo walks each step `pending` → `in_progress` → `completed` (or `failed` on worker error). `skipped` is documented but unused.

### EventType

| EventType | Used by the demo |
|---|---|
| `status_change` | — |
| `step_started` | ✅ per step transition |
| `step_completed` | ✅ per step transition |
| `step_failed` | ✅ on worker error |
| `tool_call` | — |
| `tool_result` | — |
| `message` | — |
| `error` | — |
| `custom` | ✅ one per call attempt |

The `custom` event carries `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}`.

### Scheduled-event status (EventStatus)

| Status | Terminal? |
|---|---|
| `pending` | no |
| `in_progress` | no |
| `completed` | yes → step `completed` |
| `failed` | yes → step `failed` |

---

## Running the smoke test

The smoke test verifies every workflow script imports cleanly and exposes `_main()`, that the dispatcher lists all five scripts, that the plan has exactly three steps, and that the audit module documents the full `RunStatus` enum.

```bash
pytest smoke_test.py -v
```

It should pass before you run the live workflow. If it fails, you're missing a dependency or a script has a syntax error.

---

## Troubleshooting

**`TELNYX_API_KEY is not set.`**
You haven't copied `.env.example` to `.env`, or the key is empty. Every script checks this at startup and exits with this message.

**`ASSISTANT_PHONE_NUMBER is not set.`**
In live mode, the scheduled event needs a `telnyx_agent_target` — a phone number associated with your assistant. Associate one in the Telnyx Portal under **AI → Assistants → Phone Numbers**, then set `ASSISTANT_PHONE_NUMBER` in `.env`. The script exits with this exact instruction.

**`DESTINATION_NUMBER is not set in .env.`**
Live mode needs a destination number. Set it in `.env`.

**`Need --mission-id and --run-id (or MISSION_ID / RUN_ID in .env).`**
You skipped a step. Run `create_mission.py` first, paste the `mission_id` into `.env`, then `start_run.py`, and so on.

**The run never reaches terminal status.**
`audit.py` polls for up to 10 minutes. If the run is still `running` after that, it renders the current state anyway. Check the scheduled event's status in the Portal — if it's stuck in `pending`, the assistant may not have a phone number associated.

**`audit.py` shows an empty event timeline.**
You probably ran `execute.py` in demo mode without the step IDs. Make sure `--step-ids` (or `STEP_IDS` in `.env`) contains all three IDs from `plan_steps.py`.

---

## Next steps

- **Loop the plan for multiple contacts.** The demo places one call. To exercise the "3 contacts" objective, wrap the `execute.py` step-2/step-3 logic in a loop over a list of destination numbers, logging one `custom` event per attempt with an incrementing `attempt_number`.
- **Exercise `paused` and `cancelled`.** The `PATCH .../runs/{run_id}` endpoint accepts `status`, `result_summary`, and `result_payload`. Try pausing a run mid-flight and resuming it, then re-run `audit.py` to see the transitions in the ledger.
- **Add `tool_call` / `tool_result` events.** If your assistant uses tools, log those events too — the `EventType` enum supports them and the audit renderer will show them in the timeline.

### Reference docs

- [Voice outreach with AI missions](https://developers.telnyx.com/docs/inference/missions)
- [Missions API reference index](https://developers.telnyx.com/api-reference/missions)
- [Create mission](https://developers.telnyx.com/api-reference/missions/create-mission)
- [Start a run](https://developers.telnyx.com/api-reference/missions/start-a-run)
- [List runs for mission](https://developers.telnyx.com/api-reference/missions/list-runs-for-mission)
- [Create initial plan](https://developers.telnyx.com/api-reference/missions/create-initial-plan)
- [Update run](https://developers.telnyx.com/api-reference/missions/update-run)
- [Update step status](https://developers.telnyx.com/api-reference/missions/update-step-status)
- [Log event](https://developers.telnyx.com/api-reference/missions/log-event)
- [List linked Telnyx agents](https://developers.telnyx.com/api-reference/missions/list-linked-telnyx-agents)
