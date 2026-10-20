---
name: missions-audit
title: "Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission"
description: "Drive one Telnyx AI mission end-to-end and render a timestamped audit trail of what was planned, what ran, and what failed."
language: python
framework: vanilla
telnyx_products: [AI Missions, AI Assistants, Scheduled Events]
---

# Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission

Drive one Telnyx AI mission end-to-end — create, run, plan steps, log typed events, link the assistant — then render a timestamped audit report of the whole ledger.

## The Story

A regional clinic network runs a daily outreach campaign: care coordinators call patients to confirm upcoming appointment slots, and every one of those calls has to be defensible. If a coordinator says a patient was reached, the network needs to show when the call was placed, which assistant handled it, what the outcome was, and who signed off on the plan — because a missed confirmation is a no-show, a no-show is lost revenue, and an undocumented call is a compliance problem the moment a payer asks for the record. The mission is the durable actor: it is born the moment a coordinator commits to an objective ("verify 3 clinic contacts can be reached"), it evolves as each run plans its steps and the worker advances them one by one, and it completes — or terminates as failed — with a result summary a reviewer can replay months later. The mission and its run persist through the ordinary chaos of the job: the worker script crashing mid-campaign, the scheduled call sitting in `in_progress` longer than expected, an operator pausing a run to re-check a number. Every state change the worker observes is mirrored into the ledger, so the record reflects the world, not the worker's self-report. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — the mission ledger, the AI assistant, and the scheduled call all live on one platform, so the audit trail is a first-class API resource rather than something you bolt on afterwards. The Missions API records what was planned, what ran, and what failed as durable, queryable objects; the assistant that places the call is the same assistant you link back to the run. There is no separate observability vendor, no log-scraping glue, and no gap between "the call happened" and "the call is documented."

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/missions` | Create the durable mission (`name` required) |
| `GET` | `/ai/missions` | List missions (paginated) |
| `GET` | `/ai/missions/{mission_id}` | Mission detail |
| `POST` | `/ai/missions/{mission_id}/runs` | Start one execution of the mission |
| `GET` | `/ai/missions/{mission_id}/runs` | List runs for a mission |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}` | Run detail — `RunStatus`, `result_summary`, `result_payload` |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}` | Update run status / `result_summary` / `result_payload` |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/plan` | Submit the initial plan |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/plan` | Fetch the planned steps |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}/plan/steps/{step_id}` | Advance a step status |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/events` | Log a typed event (`type` + `summary` required) |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/events` | List events (the audit timeline) |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | Link the assistant to the run |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | List linked agents |
| `POST` | `/ai/assistants` | Create the demo outreach assistant |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | Schedule the outreach call |
| `GET` | `/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Poll the scheduled event to terminal status |

The Missions surface is invoked via raw REST against `TELNYX_API_BASE` (default `https://api.telnyx.com/v2`) with `Authorization: Bearer $TELNYX_API_KEY`, unwrapping the `{"data": ...}` envelope. The Assistants and scheduled-events endpoints return the object **bare** (no envelope) — see `API.md` for the full typed contract.

## Architecture

The audit desk is a small loop around one durable objective. The **mission** is the durable objective — the thing that persists across runs. A **run** is one execution of it, and each run carries a **plan** whose step statuses the executor advances as work happens. The **worker** (`execute.py`) is the actor doing real work: creating the assistant, creating the scheduled event, watching it reach terminal status. Its contract is honesty — it logs every state change it observes, not only its own actions. The **audit renderer** (`audit.py`) pulls mission, run, plan, events, and agent linkage into one chronological report.

```text
  create_mission.py        start_run.py              plan_steps.py
  ┌──────────────┐        ┌──────────────┐          ┌──────────────────┐
  │ POST         │        │ POST         │          │ POST             │
  │ /ai/missions │───────▶│ .../runs     │─────────▶│ .../runs/{rid}/  │
  │              │        │              │          │      plan        │
  └──────┬───────┘        └──────┬───────┘          └────────┬─────────┘
         │ mission_id            │ run_id                    │ step_ids
         ▼                       ▼                           ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                          execute.py  (WORKER)                    │
  │                                                                  │
  │  step 1: provision assistant ──▶ POST /ai/assistants             │
  │  step 2: schedule call       ──▶ POST .../scheduled_events       │
  │  step 3: verify outcome      ──▶ GET  .../scheduled_events/{id}  │
  │                                                                  │
  │  after every unit of work:                                       │
  │    PATCH .../plan/steps/{step_id} (pending→in_progress→…)        │
  │    POST  .../events              (step_started/step_completed/…) │
  │    PATCH .../runs/{run_id}       (running → succeeded | failed)  │
  │    POST  .../telnyx-agents       (link the assistant to the run) │
  └───────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                          audit.py  (RENDERER)                    │
  │                                                                  │
  │  poll GET .../runs/{run_id} until terminal (cap 10 min)          │
  │  fresh GET run / plan / events / telnyx-agents   (cross-check)   │
  │                                                                  │
  │  ──▶ MISSIONS AUDIT REPORT (timestamped, in order)               │
  └──────────────────────────────────────────────────────────────────┘
```

**RunStatus enum** (walked by the demo: `pending` → `running` → `succeeded` | `failed`):

| Status | Meaning |
|--------|---------|
| `pending` | Run created, no work started. |
| `running` | Worker is executing steps. |
| `paused` | Run suspended; resume via `POST .../runs/{run_id}/resume`. |
| `succeeded` | All steps completed. |
| `failed` | A step failed; see `result_summary`. |
| `cancelled` | Run cancelled via `POST .../runs/{run_id}/cancel`. |

**StepStatus enum** (walked by the demo: `pending` → `in_progress` → `completed` | `failed`; `skipped` is documented but unused):

| Status | Meaning |
|--------|---------|
| `pending` | Planned, not started. |
| `in_progress` | Worker is executing this step. |
| `completed` | Step finished successfully. |
| `skipped` | Step intentionally not run. |
| `failed` | Step raised an error. |

**EventType enum** (logged by the worker): `status_change`, `step_started`, `step_completed`, `step_failed`, `tool_call`, `tool_result`, `message`, `error`, `custom`. The worker logs `step_started` / `step_completed` / `step_failed` per step transition (with the `step_id` field set), one `custom` event per call attempt with `payload` `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}`, one `status_change` event per observed scheduled-event transition, and `error` events for poll timeouts or linkage failures.

**Linked-agents response shape** (`TelnyxAgentData`): `run_id`, `telnyx_agent_id`, `created_at`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | yes | Telnyx API key used for all Bearer-authenticated calls. | Telnyx Portal → API Keys |
| `TELNYX_API_BASE` | `string` | `https://api.telnyx.com/v2` | no | Telnyx API base URL. Override only for a non-production environment. | — |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) walks the missions ledger with no assistant, no scheduled event, and no call. `false` runs the live campaign. | — |
| `DESTINATION_NUMBER` | `string` | `+15550001234` | yes (live) | The contact number the outreach call is placed to (E.164, validated by `execute.py`). | Your CRM / test number |
| `ASSISTANT_PHONE_NUMBER` | `string` | `+15550001234` | yes (live) | Phone number associated with the assistant in the Portal; used as `telnyx_agent_target` on the scheduled event. | Telnyx Portal → AI → Assistants → Phone Numbers |
| `ASSISTANT_ID` | `string` | `assistant-1234abcd` | no | Reuse an existing assistant instead of creating one (live mode). | Output of a previous run, or Telnyx Portal |
| `MISSION_ID` | `string` | `your_mission_id_here` | no | Mission id from `create_mission.py`; used as the default by later scripts. | Output of `create_mission.py` |
| `RUN_ID` | `string` | `your_run_id_here` | no | Run id from `start_run.py`; used as the default by later scripts. | Output of `start_run.py` |

> **Agent / CLI access** — provision and inspect missions programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx ai:missions create --name "Clinic outreach audit"
> telnyx ai:missions list
> ```
>
> Phone numbers and assistants are provisioned in the Telnyx Portal (AI → Assistants → Phone Numbers). Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/missions-audit

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# edit .env: set TELNYX_API_KEY (all other vars are optional for demo mode)
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Inspect existing missions (create_mission.py creates the mission itself)
telnyx ai:missions list
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

The workflow is five standalone scripts, run in order. Each one prints the ids the next one needs.

| # | Script | Role | Command |
|---|--------|------|---------|
| 1 | `create_mission.py` | Create the mission via `POST /ai/missions`, print `mission_id`, list missions. | `python create_mission.py` |
| 2 | `start_run.py` | Start a run via `POST /ai/missions/{mission_id}/runs`, print `run_id` and initial status. | `python start_run.py --mission-id <MISSION_ID>` |
| 3 | `plan_steps.py` | Submit the initial 3-step plan via `POST .../runs/{run_id}/plan`, print step ids. | `python plan_steps.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |
| 4 | `execute.py` | Run the campaign: advance each step, log events; in live mode create the assistant, schedule the call, poll it, link the assistant. | `python execute.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |
| 5 | `audit.py` | Wait for terminal status, cross-check with a fresh `GET`, render the audit report. | `python audit.py --mission-id <MISSION_ID> --run-id <RUN_ID>` |

`app.py` is a thin help-dispatcher — it prints the menu and points you at the right script:

```bash
python app.py --list
```

Run the smoke test to confirm every module imports and the enums/plan are intact:

```bash
pytest smoke_test.py -q
```

### Demo mode vs live mode

`DEMO_MODE=true` (the default) is safe by default: `execute.py` walks the full missions ledger — run status, all three steps, step events, the terminal run update — but creates **no assistant**, creates **no scheduled event**, places **no call**, and performs **no agent linkage**. Every event it logs describes the simulated walk (it never records a call status or scheduled-event id that does not exist), and the run finishes `succeeded` with an honest `result_summary` saying exactly that.

Set `DEMO_MODE=false` in `.env` to place the real scheduled call through the assistant. Live mode requires `DESTINATION_NUMBER` (validated as E.164) and `ASSISTANT_PHONE_NUMBER`; the script exits with an actionable error if either is missing.

### Looping the plan for multiple contacts

The demo places **one** call — the "3 contacts" objective is the mission description string only, and the 3-step plan executes once so the audit ledger stays focused on the trail mechanics. To cover multiple contacts, wrap the `execute.py` step loop in a `for` over your contact list, submitting a fresh plan per contact (or one plan with a step per contact) and logging one `custom` event per attempt with an incrementing `attempt_number`.

## API Reference

Each script exposes a CLI and a small set of importable functions. Full request/response shapes are in `API.md`.

### `create_mission.py`

```text
python create_mission.py [--name TEXT] [--description TEXT] [--instructions TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `create_mission` | `(name, description=None, instructions=None, execution_mode="external") -> dict` | `POST /ai/missions` |
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
| `create_plan` | `(mission_id, run_id, steps=None) -> list[dict]` | `POST /ai/missions/{mission_id}/runs/{run_id}/plan` |
| `get_plan` | `(mission_id, run_id) -> list[dict]` | `GET .../runs/{run_id}/plan` |

Default plan: `provision_assistant` → `schedule_outreach_call` → `verify_outcome` (sequences 1–3).

### `execute.py`

```text
python execute.py [--mission-id TEXT] [--run-id TEXT]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `update_step` | `(mission_id, run_id, step_id, status) -> dict` | `PATCH .../plan/steps/{step_id}` |
| `log_event` | `(mission_id, run_id, event_type, summary, step_id=None, payload=None) -> dict` | `POST .../events` |
| `update_run` | `(mission_id, run_id, status=None, summary=None, payload=None) -> dict` | `PATCH .../runs/{run_id}` |
| `link_agent` | `(mission_id, run_id, assistant_id) -> dict` | `POST .../telnyx-agents` |
| `list_linked_agents` | `(mission_id, run_id) -> list[dict]` | `GET .../telnyx-agents` |
| `create_assistant` | `() -> str` | `POST /ai/assistants` |
| `create_scheduled_event` | `(assistant_id, agent_target, end_user_target) -> dict` | `POST .../scheduled_events` |
| `get_scheduled_event` | `(assistant_id, event_id) -> dict` | `GET .../scheduled_events/{event_id}` |

The worker polls `GET /ai/assistants/{assistant_id}/scheduled_events/{event_id}` every 5 seconds with a hard cap of 10 minutes, mirroring every observed status change as a `status_change` missions event. A poll timeout is logged as an `error` event and fails the verify step — the ledger never claims a call outcome the platform did not report.

### `audit.py`

```text
python audit.py [--mission-id TEXT] [--run-id TEXT] [--nowait]
```

| Function | Signature | Endpoint |
|----------|-----------|----------|
| `wait_for_terminal` | `(mission_id, run_id) -> tuple[dict, bool]` | `GET .../runs/{run_id}` (polled) |

Renders the mission, run, per-step planned-vs-completed table, the full event timeline with `EventType` values, the linked agent rows, and both status enums. Exits `0` on a terminal run, `1` otherwise (and warns if the 10-minute poll cap was reached).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TELNYX_API_KEY is not set` | `.env` missing or not loaded | `cp .env.example .env` and set `TELNYX_API_KEY` |
| `422 ... name: field required` on create | Mission create payload missing `name` | `create_mission.py` sends `name` by default; pass `--name` if you overrode it |
| `ASSISTANT_PHONE_NUMBER is not set` | Live mode with no portal-associated number | Telnyx Portal → AI → Assistants → Phone Numbers, associate a number, then set `ASSISTANT_PHONE_NUMBER` in `.env` |
| `DESTINATION_NUMBER ... is not a valid E.164 number` | Bad destination format (live mode) | Set an E.164 number, e.g. `+15550001234` |
| `expected 3 planned steps; run plan_steps.py first` | `execute.py` run before the plan was submitted | Run `plan_steps.py` with the same `--mission-id` / `--run-id` |
| `404 Not Found` on step updates | Step endpoints miss the `/plan/` segment | Steps live under `.../runs/{run_id}/plan/steps/{step_id}` — the scripts already do this |
| Audit report shows `status: running` | Run never reached terminal within the 10-minute cap | Check the scheduled event in the Portal; re-run `audit.py` (or with `--nowait`) |
| Step 3 fails with `scheduled event ended as failed` | The scheduled call failed | The run is marked `failed` with a `result_summary` naming the failing step — inspect the event timeline |
| `401 Unauthorized` from any endpoint | Bad or expired API key | Regenerate the key in the Portal and update `.env` |
| `429 Too Many Requests` | Polling too aggressively | The scripts already poll at 5s intervals; reduce concurrency |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [Missions AI Task Runner](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/missions-ai-task-runner-python/README.md) — AI-driven task execution within the Telnyx Missions framework
- [Missions Workflow Orchestrator](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/missions-workflow-orchestrator-python/README.md) — create and manage multi-step mission workflows

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
- [Scheduled events for AI assistants](https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event)
- [Telnyx Python SDK](https://developers.telnyx.com/development/sdk/python)
- [AI Assistants product page](https://telnyx.com/ai-assistants)
- [Telnyx pricing](https://telnyx.com/pricing)
