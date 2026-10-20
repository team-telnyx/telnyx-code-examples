---
name: missions-audit
title: "Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission"
description: "Drive one Telnyx AI mission end-to-end and render a timestamped audit trail of what was planned, what ran, and what failed."
language: python
framework: flask
telnyx_products: [AI Missions, AI Assistants, Scheduled Events]
---

# Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission

Drive one Telnyx AI mission end-to-end — create, run, plan steps, log typed events, link the assistant — then render a timestamped audit report of the whole ledger.

## The Story

A regional clinic network runs a daily outreach campaign: a small team of care coordinators calls patients to confirm upcoming appointment slots, and every one of those calls has to be defensible. If a coordinator says a patient was reached, the network needs to show when the call was placed, which assistant handled it, what the outcome was, and who signed off on the plan — because a missed confirmation is a no-show, a no-show is lost revenue, and an undocumented call is a compliance problem the moment a payer asks for the record. The actor IS the mission. It is born the moment a coordinator commits to an objective ("verify 3 clinic contacts can be reached"), it evolves as each run plans its steps and the worker advances them one by one, and it completes — or terminates as failed — with a result summary that a reviewer can replay months later. It survives the ordinary chaos of the job: the worker script crashes mid-campaign, the scheduled call sits in `in_progress` far longer than expected, the operator pauses a run to re-check a number — the mission and its run persist through all of it, and every state change the worker observes is mirrored into the ledger so the record reflects the world, not the worker's self-report. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — the mission ledger, the AI assistant, and the scheduled call all live on one platform, so the audit trail is a first-class API resource rather than something you bolt on afterwards. The Missions API records what was planned, what ran, and what failed as durable, queryable objects; the assistant that places the call is the same assistant you link back to the run. There is no separate observability vendor, no log-scraping glue, and no gap between "the call happened" and "the call is documented."

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/missions` | Create the durable mission objective |
| `GET` | `/ai/missions` | List missions (resource shape) |
| `GET` | `/ai/missions/{mission_id}` | Get a single mission |
| `POST` | `/ai/missions/{mission_id}/runs` | Start one execution of the mission |
| `GET` | `/ai/missions/{mission_id}/runs` | List runs for a mission |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}` | Run detail — `RunStatus`, `result_summary`, `result_payload` |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}` | Update run status / result summary |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/steps` | Submit the initial plan |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}` | Advance a step status |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/events` | Log a typed event with `properties` |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | Link the assistant to the run |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | List linked agents |
| `POST` | `/ai/assistants` | Create the demo outreach assistant (SDK typed) |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | Schedule the outreach call |
| `GET` | `/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Poll the scheduled event to terminal status |

> The Missions endpoints are **untyped** in the shipped `telnyx` SDK, so this sample calls them via raw REST with a Bearer token and unwraps the `{"data": ...}` envelope. The assistant create uses the typed SDK (`telnyx.AIAssistant.create`).

## Architecture

The audit desk is a small loop around one durable objective. The **mission** is the durable objective — the thing that persists across runs. A **run** is one execution of it, and each run carries **steps** whose statuses the executor advances as work happens. The **worker** (`execute.py`) is the actor doing real work: creating the assistant, creating the scheduled event, watching it reach terminal status. Its contract is honesty — it logs every state change it observes, not only its own actions. The **audit renderer** (`audit.py`) pulls run detail, steps, events, and agent linkage into one chronological report.

```text
  create_mission.py        start_run.py           plan_steps.py
  ┌──────────────┐        ┌──────────────┐       ┌──────────────────┐
  │ POST         │        │ POST         │       │ POST             │
  │ /ai/missions │───────▶│ .../runs     │──────▶│ .../runs/{id}/   │
  │              │        │              │       │      steps       │
  └──────┬───────┘        └──────┬───────┘       └────────┬─────────┘
         │ mission_id            │ run_id                 │ step_ids
         ▼                       ▼                        ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                          execute.py  (WORKER)                    │
  │                                                                  │
  │  step 1: provision assistant ──▶ telnyx.AIAssistant.create       │
  │  step 2: schedule call       ──▶ POST .../scheduled_events       │
  │  step 3: verify outcome      ──▶ GET  .../scheduled_events/{id}  │
  │                                                                  │
  │  after every unit of work:                                       │
  │    PATCH .../steps/{step_id}   (pending→in_progress→completed)   │
  │    POST  .../events            (step_started/step_completed/…)   │
  │    PATCH .../runs/{run_id}     (running → succeeded | failed)    │
  │    POST  .../telnyx-agents     (link the assistant to the run)   │
  └───────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                          audit.py  (RENDERER)                    │
  │                                                                  │
  │  poll GET .../runs/{run_id} until terminal (cap 10 min)          │
  │  fresh GET .../runs/{run_id}          (cross-check)              │
  │  GET .../runs/{run_id}/steps          (planned vs completed)     │
  │  GET .../runs/{run_id}/events         (event timeline)           │
  │  GET .../runs/{run_id}/telnyx-agents  (linked agents)            │
  │                                                                  │
  │  ──▶ MISSIONS AUDIT REPORT (timestamped, in order)               │
  └──────────────────────────────────────────────────────────────────┘
```

**RunStatus enum** (walked by the demo: `pending` → `running` → `succeeded` | `failed`):

| Status | Meaning |
|--------|---------|
| `pending` | Run created, no work started. |
| `running` | Worker is executing steps. |
| `paused` | Run suspended; resume via `PATCH .../runs/{run_id}`. |
| `succeeded` | All steps completed. |
| `failed` | A step failed; see `result_summary`. |
| `cancelled` | Run cancelled by operator. |

**Step status enum** (walked by the demo: `pending` → `in_progress` → `completed` | `failed`):

| Status | Meaning |
|--------|---------|
| `pending` | Planned, not started. |
| `in_progress` | Worker is executing this step. |
| `completed` | Step finished successfully. |
| `skipped` | Step intentionally not run. |
| `failed` | Step raised an error. |

**EventType enum** (logged by the worker): `status_change`, `step_started`, `step_completed`, `step_failed`, `tool_call`, `tool_result`, `message`, `error`, `custom`. The worker logs `step_started` / `step_completed` / `step_failed` per step transition (properties carry `step_id`, `step_name`), plus one `custom` event per call attempt with properties `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}`.

**Linked-agents response shape** (`TelnyxAgentData`): `run_id`, `telnyx_agent_id`, `created_at`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | **yes** | Reuse an existing assistant instead of creating one. Leave blank to let `execute.py` create the demo assistant. | Telnyx Portal → AI → Assistants |
| `ASSISTANT_PHONE_NUMBER` | `string` | `your_assistant_phone_number_here` | **yes** | Phone number associated with the assistant; used as `telnyx_agent_target` on the scheduled event. | Telnyx Portal → AI → Assistants → Phone Numbers |
| `DEMO_MODE` | `string` | `true` | **yes** | `true` (default) logs what would happen without placing a real call; `false` places the real scheduled call. | — |
| `DESTINATION_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | The contact number the outreach call is placed to. | Your CRM / test number |
| `MISSION_ID` | `string` | `your_mission_id_here` | **yes** | Mission id from `create_mission.py`; used as the default for later scripts. | Output of `create_mission.py` |
| `RUN_ID` | `string` | `your_run_id_here` | **yes** | Run id from `start_run.py`; used as the default for later scripts. | Output of `start_run.py` |
| `TELNYX_API_BASE` | `string` | `https://api.telnyx.com/v2` | **yes** | Telnyx API base URL. Override only for a non-production environment. | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key used for all Bearer-authenticated calls. | Telnyx Portal → API Keys |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/missions-audit

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# edit .env: set TELNYX_API_KEY, DESTINATION_NUMBER, ASSISTANT_PHONE_NUMBER
```

The workflow is five standalone scripts, run in order. Each one prints the ids the next one needs.

| # | Script | Role | Command |
|---|--------|------|---------|
| 1 | `create_mission.py` | Create the mission via `POST /ai/missions`, print `mission_id`, list missions. | `python create_mission.py --objective "Verify 3 clinic contacts can be reached"` |
| 2 | `start_run.py` | Start a run via `POST /ai/missions/{mission_id}/runs`, print `run_id` and initial status. | `python start_run.py --mission-id <MISSION_ID>` |
| 3 | `plan_steps.py` | Submit the initial 3-step plan via `POST .../runs/{run_id}/steps`, print step ids. | `python plan_steps.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |
| 4 | `execute.py` | Run the campaign: create the assistant, schedule the call, advance each step, log events, link the assistant. | `python execute.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |
| 5 | `audit.py` | Wait for terminal status, cross-check with a fresh `GET`, render the audit report. | `python audit.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |

`app.py` is a thin help-dispatcher — it prints the menu and points you at the right script:

```bash
python app.py --list
```

Run the smoke test to confirm every module imports and exposes `_main()`:

```bash
pytest smoke_test.py -q
```

### Demo mode vs live mode

`DEMO_MODE=true` (the default) is the safe path: `execute.py` logs `[DEMO] would create scheduled event to +15***89 from +15***01` and still drives the full missions ledger, so you can exercise the audit trail without placing a real call. Set `DEMO_MODE=false` in `.env` to place the real scheduled call through the assistant. See `GUIDE.md` for the full walkthrough.

### Looping the plan for multiple contacts

The demo places **one** call — the "3 contacts" objective is the mission objective string only, and the 3-step plan executes once so the audit ledger stays focused on the trail mechanics. To cover multiple contacts, wrap the `execute.py` step loop in a `for` over your contact list, submitting a fresh plan per contact (or one plan with a step per contact) and logging one `custom` event per attempt with an incrementing `attempt_number`.

## API Reference

Each script exposes a CLI and a small set of importable functions. Full request/response shapes are in `API.md`.

### `create_mission.py`

```text
python create_mission.py [--objective TEXT] [--name TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `create_mission` | `(objective: str, name: str \| None = None) -> dict` | `POST /ai/missions` |
| `list_missions` | `(limit: int = 5) -> list[dict]` | `GET /ai/missions` |

### `start_run.py`

```text
python start_run.py [--mission-id TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `start_run` | `(mission_id: str) -> dict` | `POST /ai/missions/{mission_id}/runs` |
| `list_runs` | `(mission_id: str) -> list[dict]` | `GET /ai/missions/{mission_id}/runs` |

### `plan_steps.py`

```text
python plan_steps.py [--mission-id TEXT] [--run-id TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `create_plan` | `(mission_id: str, run_id: str, steps: list[dict] \| None = None) -> list[dict]` | `POST /ai/missions/{mission_id}/runs/{run_id}/steps` |

Default plan: `Provision assistant` → `Schedule outreach call` → `Verify outcome`.

### `execute.py`

```text
python execute.py [--mission-id TEXT] [--run-id TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `update_step` | `(mission_id, run_id, step_id, status) -> dict` | `PATCH .../steps/{step_id}` |
| `log_event` | `(mission_id, run_id, event_type, properties) -> dict` | `POST .../events` |
| `update_run` | `(mission_id, run_id, status, summary) -> dict` | `PATCH .../runs/{run_id}` |
| `link_agent` | `(mission_id, run_id, assistant_id) -> dict` | `POST .../telnyx-agents` |
| `list_linked_agents` | `(mission_id, run_id) -> list[dict]` | `GET .../telnyx-agents` |

The worker polls `GET /ai/assistants/{assistant_id}/scheduled_events/{event_id}` every 5 seconds with a hard cap of 10 minutes, mirroring every observed status change as a missions event.

### `audit.py`

```text
python audit.py [--mission-id TEXT] [--run-id TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `wait_for_terminal` | `(mission_id: str, run_id: str) -> dict` | `GET .../runs/{run_id}` (polled) |

Renders the mission, run, per-step planned-vs-completed table, the full event timeline with `EventType` values, the linked agent rows, and both status enums. Exits `0` on a terminal run, `1` otherwise.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TELNYX_API_KEY is not set` | `.env` missing or not loaded | `cp .env.example .env` and set `TELNYX_API_KEY` |
| `ASSISTANT_PHONE_NUMBER is not set` | No phone number associated with the assistant | Telnyx Portal → AI → Assistants → Phone Numbers, associate a number, then set `ASSISTANT_PHONE_NUMBER` in `.env` |
| `DESTINATION_NUMBER is not set in .env` | Contact number missing | Set `DESTINATION_NUMBER` (E.164, e.g. `+1555XXXXXXXX`) |
| `expected 3 planned steps; run plan_steps.py first` | `execute.py` run before the plan was submitted | Run `plan_steps.py` with the same `--mission-id` / `--run-id` |
| `--mission-id and --run-id are required` | Ids not passed and not in env | Pass the flags or set `MISSION_ID` / `RUN_ID` in `.env` |
| Audit report shows `status: running` | Run never reached terminal within the 10-minute cap | Check the scheduled event in the Portal; re-run `audit.py` |
| Step 3 fails with `scheduled event ended as failed` | The scheduled call failed | The run is marked `failed` with a `result_summary` naming the failing step — inspect the event timeline |
| `401 Unauthorized` from any endpoint | Bad or expired API key | Regenerate the key in the Portal and update `.env` |
| `429 Too Many Requests` | Polling too aggressively | The scripts already poll at 5s intervals; reduce concurrency |

## Agent Discovery

- Agent signup: <https://telnyx.com/agent-signup.md>
- Telnyx AI examples: <https://github.com/team-telnyx/ai>
- LLM index: <https://telnyx.com/llms.txt>

## Related Examples

- Voice outreach with AI missions — the portal-flow companion to this raw-endpoint sample
- AI Assistants — create and configure the assistant that places the call
- Scheduled Events — the worker primitive behind step 2

## Resources

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
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx pricing](https://telnyx.com/pricing)
