---
name: missions-audit
title: "Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission"
description: "Drive one Telnyx AI Missions mission end-to-end and render a complete, replayable audit trail of what was planned, what ran, and what failed."
language: python
framework: flask
telnyx_products: [AI Missions, AI Assistants, Scheduled Events]
---

# Missions Audit Desk — Plan, Run, and Forensically Trace an Agent Mission

A Python sample that drives one **AI Missions** mission end-to-end — create, run, plan, execute, link, audit — and produces a full, timestamped ledger of what was planned, what ran, and what failed.

## The Story

A multi-site **outpatient clinic network** runs a daily outreach campaign: an AI assistant calls patients to confirm appointment slots before the schedule locks. If a call silently fails, the patient shows up to a cancelled slot, the clinician's hour is wasted, and the clinic eats the no-show cost — and in a regulated care setting, an unreconstructable outreach record is a compliance problem, not just an ops annoyance. The clinic's operations lead needs to answer one question after every campaign: *what did we plan, what actually happened, and where did it break?*

The actor IS the **mission**. It is born the moment the operations lead states the objective ("verify 3 clinic contacts can be reached") and persists across every run of that objective — today's campaign, tomorrow's retry, next week's follow-up. It evolves as a run starts, a three-step plan is submitted, and each step advances from `pending` to `in_progress` to `completed` or `failed`. It survives the messy middle: the worker process is killed mid-campaign, the scheduled call sits in `in_progress` for minutes, the platform returns a terminal `failed` — and the mission is still there, still holding the plan, still holding every event the worker mirrored into it. It completes when the run reaches `succeeded`, or terminates honestly when it reaches `failed` with a `result_summary` naming the step that broke. Nothing is lost, because the ledger records the platform's own responses, not just the worker's self-report.

The rest of this README is the API surface of that story.

## Why Telnyx

Agentic outreach fails quietly. A worker crashes, a call never connects, a step is marked done by a script that lied — and nobody can reconstruct the sequence afterward. Telnyx **AI Communications Infrastructure** puts the orchestration ledger in the platform: missions persist the objective, runs record each execution, steps carry their own status, and typed events capture every state change the worker observes. The audit trail is a first-class API resource, not a log file you hope survived.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/missions` | Create the durable mission (objective). |
| `GET` | `/ai/missions` | List missions — shows the resource shape. |
| `GET` | `/ai/missions/{mission_id}` | Get mission detail for the audit report. |
| `POST` | `/ai/missions/{mission_id}/runs` | Start a run of the mission. |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}` | Run detail: `status`, `result_summary`, `result_payload`. |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}` | Update run status (`succeeded` / `failed` / `paused` / `cancelled`). |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/steps` | Submit the initial 3-step plan. |
| `PATCH` | `/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}` | Advance a step status. |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/events` | Log a typed event with `properties`. |
| `POST` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | Link the assistant to the run. |
| `GET` | `/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents` | List linked agents (`run_id`, `telnyx_agent_id`, `created_at`). |
| `POST` | `/ai/assistants` | Create the demo clinic-outreach assistant. |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | Schedule the outreach phone call. |
| `GET` | `/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Poll the scheduled event to terminal status. |

## Architecture

The audit desk is a small loop around one durable objective. The **mission** is the objective that persists across runs. A **run** is one execution of it, carrying **steps** whose statuses the executor advances. The **worker** does the real work — creating the assistant, scheduling the call, watching it reach terminal status — and its contract is honesty: it mirrors every state change it observes, including the platform's own responses, into the missions ledger. The **audit renderer** pulls run detail, steps, events, and agent linkage into one chronological report.

```text
  create_mission.py        start_run.py          plan_steps.py
        │                       │                      │
        ▼                       ▼                      ▼
  POST /ai/missions  ──►  POST .../runs  ──►  POST .../runs/{run_id}/steps
        │                       │                      │
   mission_id              run_id (pending)       3 step IDs (pending)
        │                       │                      │
        └───────────┬───────────┴──────────────────────┘
                    ▼
              execute.py  (the worker — honesty contract)
                    │
        ┌───────────┼────────────────────────────┐
        ▼           ▼                            ▼
  POST /ai/assistants   POST .../scheduled_events   PATCH .../steps/{step_id}
        │                       │                            │
        │                  poll every 5s                     │
        │                  (10 min hard cap)                  │
        │                       │                            │
        │              terminal: completed|failed            │
        │                       │                            │
        └───────────┬───────────┴────────────────────────────┘
                    ▼
        POST .../runs/{run_id}/events   (EventType + properties)
        POST .../runs/{run_id}/telnyx-agents   (link assistant)
        PATCH .../runs/{run_id}   (succeeded | failed + result_summary)
                    │
                    ▼
              audit.py  ──►  GET run + steps + events + telnyx-agents
                    │
                    ▼
        ┌───────────────────────────────────────────────┐
        │  MISSIONS AUDIT REPORT                        │
        │  mission · run · steps (planned vs completed) │
        │  event timeline · linked agents · RunStatus   │
        └───────────────────────────────────────────────┘
```

**RunStatus enum (full):**

| Status | Meaning |
|--------|---------|
| `pending` | Run created, not yet started. |
| `running` | Run is executing steps. |
| `paused` | Run paused by operator (`PATCH` update-run). |
| `succeeded` | Run completed successfully. |
| `failed` | Run failed; see `result_summary`. |
| `cancelled` | Run cancelled by operator. |

**Step status enum:** `pending` · `in_progress` · `completed` · `skipped` · `failed`. The demo walks each step `pending → in_progress → completed` (or `failed` on worker error). `skipped` is available in the API but unused here.

**EventType enum:** `status_change` · `step_started` · `step_completed` · `step_failed` · `tool_call` · `tool_result` · `message` · `error` · `custom`. The worker logs `step_started` / `step_completed` / `step_failed` per transition, plus one `custom` event per call attempt carrying `{"scheduled_event_id", "call_status", "telnyx_call_control_id", "attempt_number"}`.

**Linked-agents response shape** (`TelnyxAgentData`): `run_id`, `telnyx_agent_id`, `created_at`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | **no** | Reuse an existing assistant instead of creating one. Leave blank to auto-create. | Telnyx Portal → AI → Assistants |
| `ASSISTANT_PHONE_NUMBER` | `string` | `your_assistant_phone_number_here` | **yes** (live mode) | Phone number associated with the assistant; used as `telnyx_agent_target` on the scheduled event. | Telnyx Portal → AI → Assistants → Phone Numbers |
| `DEMO_MODE` | `string` | `true` | **yes** | `true` (default) skips the real scheduled call and simulates a `completed` outcome. Set `false` for live mode. | — |
| `DESTINATION_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** (live mode) | The contact the assistant calls (`telnyx_end_user_target`). | Your own test number |
| `MISSION_ID` | `string` | `your_mission_id_here` | **yes** | Mission ID from `create_mission.py`; consumed by later scripts. | Output of `create_mission.py` |
| `RUN_ID` | `string` | `your_run_id_here` | **yes** | Run ID from `start_run.py`; consumed by later scripts. | Output of `start_run.py` |
| `STEP_IDS` | `string` | `your_step_ids_here` | **yes** | Comma-separated step IDs from `plan_steps.py`. | Output of `plan_steps.py` |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key used by every script. | Telnyx Portal → API Keys |

## Setup

**1. Clone and enter the sample:**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/missions-audit
```

**2. Create your `.env` from the template:**

```bash
cp
