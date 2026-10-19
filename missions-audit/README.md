---
name: missions-audit
title: "Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission"
description: "Drive one Telnyx AI Missions mission end-to-end and render a timestamped audit trail of what was planned, what ran, and what failed."
language: python
framework: flask
telnyx_products: [AI Missions, AI Assistants, Scheduled Events]
---

# Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission

Drive one Telnyx AI Missions mission end-to-end — mission, run, steps, events, linked assistant, call outcome — and render a timestamped audit trail of what was planned, what ran, and what failed.

## The Story

A regional clinic network runs a daily outreach campaign: a handful of front-desk coordinators call patients to confirm appointment slots before the schedule locks for the week. Missed confirmations mean empty chairs, unbilled slots, and patients who show up to a cancelled visit — the kind of failure that costs money and erodes trust in a system patients already find stressful. The clinic's compliance officer needs something the coordinators cannot give her: a defensible record of what the outreach system intended to do, what it actually did, and where it broke, replayable months later when a patient disputes a no-show.

The actor IS the mission. It is born the moment a coordinator types an objective — "verify 3 clinic contacts can be reached" — and it outlives any single attempt to satisfy it. It evolves through runs: each run is one execution of the objective, carrying a plan of steps whose statuses advance from `pending` to `in_progress` to `completed` or `failed` as real work happens. It survives the ordinary chaos of the job — the worker process restarts mid-campaign, the scheduled call sits in `pending` for two minutes before the platform picks it up, a coordinator closes her laptop — because the mission ledger lives on Telnyx, not in the worker's memory. It completes when the run reaches `succeeded`, or it terminates honestly at `failed` with the failing step named in `result_summary`, and either way the audit report can be rendered afterwards from the platform's own record. The rest of this README is the API surface of that story.

## Why Telnyx

Agentic outreach fails the audit test when the only record of what happened is the agent's own self-report. Telnyx **AI Communications Infrastructure** puts the ledger underneath the work: missions, runs, steps, and typed events are first-class API resources, not log lines you grep for later. The worker's contract here is honesty — every state change it observes, including the platform's own responses, is mirrored back into the missions ledger as an event. That means the audit trail records the world, not the worker's opinion of the world, and a reviewer can replay the campaign from the platform's record alone.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/missions` | Create a mission (the durable objective) |
| `GET` | `/ai/missions` | List missions to show the resource shape |
| `GET` | `/ai/missions/{mission_id}` | Retrieve a mission for the audit report |
| `POST` | `/ai/missions/{mission_id}/runs` | Start a run (initial status `pending`) |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}` | Run detail: `status`, `result_summary`, `result_payload` |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}` | Update run status on success or failure |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/steps` | Submit the initial plan (three steps) |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}` | Advance a step status |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/events` | Log a typed event with `EventType` + `properties` |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | Link the assistant to the run |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | List linked agents (`run_id`, `telnyx_agent_id`, `created_at`) |
| `POST` | `/v2/ai/assistants` | Create the demo outreach assistant |
| `POST` | `/v2/ai/assistants/{assistant_id}/scheduled_events` | Schedule the outreach phone call |
| `GET` | `/v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Poll the scheduled event to terminal status |

## Architecture

The audit desk is a small loop around one durable objective. The **mission** is the objective that persists across runs. A **run** is one execution of it, carrying **steps** whose statuses the executor advances as work happens. The **worker** does the real work — creating the assistant, creating the scheduled event, watching it reach terminal status — and mirrors every state change it observes back into the ledger. The **audit renderer** pulls run detail, steps, events, and agent linkage into one chronological report.

```text
  POST /missions                      POST /missions/{id}/runs
  ┌──────────────┐                   ┌──────────────────────┐
  │   MISSION    │ ────────────────▶ │         RUN          │
  │  (objective) │                   │  status: pending     │
  └──────────────┘                   └──────────┬───────────┘
                                                │
                          POST .../runs/{run_id}/steps  (initial plan)
                                                │
                                                ▼
                     ┌──────────────────────────────────────────┐
                     │  STEP 1  provision assistant   pending   │
                     │  STEP 2  schedule outreach call pending  │
                     │  STEP 3  verify outcome        pending   │
                     └──────────────────┬───────────────────────┘
                                        │
                     POST .../runs/{run_id}/execute   (the worker)
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
  create assistant            create scheduled event          poll to terminal
  (or reuse ASSISTANT_ID)     (telnyx_agent_target =           (5s interval,
                               ASSISTANT_PHONE_NUMBER,          10 min cap)
                               telnyx_end_user_target =
                               DESTINATION_NUMBER)
        │                               │                               │
        └───────────────┬───────────────┴───────────────┬───────────────┘
                        │                               │
        PATCH .../steps/{step_id}          POST .../runs/{run_id}/events
        (pending → in_progress →           (step_started / step_completed /
         completed | failed)                step_failed / custom / status_change)
                        │                               │
                        └───────────────┬───────────────┘
                                        ▼
                     PATCH .../runs/{run_id}   status: succeeded | failed
                                        │
                     POST .../runs/{run_id}/telnyx-agents   (link assistant)
                                        │
                                        ▼
                     GET /missions/audit/{mission_id}/{run_id}
                     ┌──────────────────────────────────────────┐
                     │  mission · run · steps (planned vs done) │
                     │  events timeline · linked agents         │
                     │  final run status · enum tables          │
                     └──────────────────────────────────────────┘
```

**Run statuses** (`RunStatus`): `pending` | `running` | `paused` | `succeeded` | `failed` | `cancelled`. The demo walks `pending` → `running` → `succeeded` or `failed`; `paused` and `cancelled` are documented in the audit report's enum table and are reachable via `PATCH /ai/missions/{mission_id}/runs/{run_id}`.

**Step statuses**: `pending` | `in_progress` | `completed` | `skipped` | `failed`. The worker walks each step `pending` → `in_progress` → `completed`, or `failed` when the scheduled call fails. `skipped` is documented but unused by the demo.

**Event types** (`EventType`): `status_change` | `step_started` | `step_completed` | `step_failed` | `tool_call` | `tool_result` | `message` | `error` | `custom`. The worker logs `step_started` / `step_completed` / `step_failed` per step transition (properties carry `step_id`, `step_name`), one `custom` event per call attempt with properties `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}`, and one `status_change` event when the polled scheduled event reaches terminal status.

**Linked agents response shape** (`TelnyxAgentData`): each row carries `run_id`, `telnyx_agent_id`, and `created_at`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | **yes** | Reuse an existing assistant instead of creating one. Leave blank to have the worker create the demo assistant. | — |
| `ASSISTANT_PHONE_NUMBER` | `string` | `your_assistant_phone_number_here` | **yes** | Phone number associated with the assistant in the Telnyx portal; used as `telnyx_agent_target` on the scheduled event. | — |
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | `true` (default) logs what would happen without placing a real call. Set `false` for live mode. | — |
| `DESTINATION_NUMBER` | `string` | `your_destination_number_here` | **yes** | The contact the outreach call is placed to (`telnyx_end_user_target`). | — |
| `POLL_INTERVAL_SECONDS` | `string` | `your_poll_interval_seconds_here` | **yes** | Seconds between scheduled-event status polls. Default `5`. | — |
| `POLL_TIMEOUT_SECONDS` | `string` | `your_poll_timeout_seconds_here` | **yes** | Hard cap on polling the scheduled event to terminal status. Default `600`. | — |
| `PORT` | `string` | `your_port_here` | **yes** | HTTP port the Flask app binds to. Default `5000`. | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key used for all Missions, Assistant, and Scheduled Event calls. | — |

## Setup

Clone the repo and move into the sample folder:

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/missions-audit
```

Create your environment file from the template and fill in the placeholders:

```bash
cp .env.example .env
```

```dotenv
TELNYX_API_KEY=your_telnyx_api_key_here
ASSISTANT_ID=
ASSISTANT_PHONE_NUMBER=+1555XXXXXXXX
DESTINATION_NUMBER=+1555XXXXXXXX
DEMO_MODE=true
POLL_INTERVAL_SECONDS=5
POLL_TIMEOUT_SECONDS=600
PORT=5000
```

Install dependencies and run the app:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Verify the app loads and the routes are registered:

```bash
python smoke_test.py
```

The app starts in **demo mode** by default (`DEMO_MODE=true`). No real call is placed — the worker logs the masked destination number and synthesizes a `completed` scheduled event so the full audit trail can be exercised without charges. To place a real call, set `DEMO_MODE=false` and make sure `ASSISTANT_PHONE_NUMBER` is a number associated with your assistant in the Telnyx portal. See `GUIDE.md` for the full demo-versus-live walkthrough.

## API Reference

Full typed reference is in `API.md`. The short version:

| Method | Route | Maps to | Purpose |
|--------|-------|---------|---------|
| `POST` | `/missions` | `create_mission.py` | Create a mission, then list missions to show the resource shape |
| `POST` | `/missions/<mission_id>/runs` | `start_run.py` | Start a run; returns `run_id` and initial status `pending` |
| `POST` | `/missions/<mission_id>/runs/<run_id>/steps` | `plan_steps.py` | Submit the initial three-step plan; returns step IDs |
| `POST` | `/missions/<mission_id>/runs/<run_id>/execute` | `execute.py` | Run the campaign: provision assistant, schedule call, verify outcome, link agent |
| `GET` | `/missions/audit/<mission_id>/<run_id>` | `audit.py` | Render the audit report: mission, run, steps, events, linked agents, enums |
| `GET` | `/health` | — | Liveness probe; reports `demo_mode` |

Example — create a mission:

```bash
curl -s -X POST http://localhost:5000/missions \
  -H 'Content-Type: application/json' \
  -d '{"objective": "Verify 3 clinic contacts can be reached"}'
```

Example — render the audit report:

```bash
curl -s http://localhost:5000/missions/audit/<mission_id>/<run_id> | python -m json.tool
```

The audit report cross-checks against a fresh `GET` of the run, steps, events, and linked agents before rendering, so every step-status advance and event log appears in order. If the scheduled call fails, the run is marked `failed` with `result_summary` naming the failing step, and the audit trail shows it.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `RuntimeError: TELNYX_API_KEY is required` at startup | `.env` missing or `TELNYX_API_KEY` unset | Copy `.env.example` to `.env` and set a real key |
| `ASSISTANT_PHONE_NUMBER is required` during execute | No portal-associated number for the assistant | In the Telnyx portal, associate a phone number with the assistant, then set `ASSISTANT_PHONE_NUMBER` in `.env` |
| `step_ids must contain exactly 3 step ids` | Execute called without the plan's step IDs | Call `POST /missions/<mission_id>/runs/<run_id>/steps` first and pass the returned `step_ids` |
| Run stays `pending` and never reaches terminal | Scheduled event still in flight, or poll cap hit | Check `POLL_TIMEOUT_SECONDS`; the worker returns the last observed status rather than hanging |
| Audit report shows empty `events` | Execute never ran, or the run ID is wrong | Confirm the run ID from `POST /missions/<mission_id>/runs` and re-run execute |
| `failed to create mission` (HTTP 502) | Upstream Telnyx error | Check `app.logger` output for the exception; verify API key scope and network access |
| Real calls placed unexpectedly | `DEMO_MODE` set to `false` | Set `DEMO_MODE=true` in `.env` to keep the sample charge-free |

## Agent Discovery

- [Agent signup](https://telnyx.com/agent-signup.md) — get an agent-ready Telnyx account
- [team-telnyx/ai](https://github.com/team-telnyx/ai) — Telnyx AI examples and tooling
- [llms.txt](https://telnyx.com/llms.txt) — machine-readable index of Telnyx documentation for agents

## Related Examples

- [Voice outreach with AI missions](https://developers.telnyx.com/docs/inference/missions) — the portal-flow companion to this raw-API sample
- AI Assistants samples — assistant creation and instruction design
- Scheduled Events samples — the call-scheduling surface the worker drives
- Call Control samples — lower-level call lifecycle if you need to replace scheduled events

## Resources

- [Missions documentation](https://developers.telnyx.com/docs/inference/missions)
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
