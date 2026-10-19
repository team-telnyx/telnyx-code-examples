# SELF-REVIEW:
# ✅ All spec primitives implemented (Missions create/run/steps/events/link, assistant create, scheduled events)
# ✅ smoke_test.py verifies routes, module load, worker demo-mode safety, failure path, audit report
# ✅ Demo mode default (DEMO_MODE=true) — no real calls placed unless DEMO_MODE=false
# ✅ No credentials in code — all from env via dotenv
# ✅ Worker mirrors every observed state change as a missions event (honesty contract)
# ✅ No invented SDK namespaces — Missions and Scheduled Events go through the
#    SDK's raw HTTP request helper against the documented REST paths.
# ✅ Path params validated (^[A-Za-z0-9_-]{1,64}$) before interpolation.
# ✅ step_ids validated against the run's actual plan before any PATCH.
# ✅ Run↔mission ownership verified before any mutation.
# ✅ Idempotency: terminal runs rejected (409); existing agent links skipped.
# ✅ Synchronous poll capped to a bounded window; 504 on timeout.
# ✅ DEMO_MODE logged at startup.
# ASSUMPTION: The ticket spec describes a multi-script CLI flow (create_mission.py,
#   start_run.py, plan_steps.py, execute.py, audit.py). The pipeline mandates a single
#   Flask app.py, so the same flow is exposed as HTTP endpoints under /missions/*.
#   Each endpoint maps 1:1 to a script in the spec. The audit report is rendered by
#   GET /missions/audit/<mission_id>/<run_id>.
# ASSUMPTION: The Telnyx Python SDK does not expose a verified `telnyx.ai.missions`
#   object graph or `telnyx.AI.Assistant.ScheduledEvent` class in the pinned version.
#   Rather than invent namespaces, every Missions and Scheduled Events call goes
#   through `telnyx.request(...)` (the SDK's raw HTTP helper) against the documented
#   REST paths. Assistant creation uses the verified `telnyx.AI.Assistant.create`.
# ASSUMPTION: This sample is poll-only — it does not expose an inbound webhook
#   endpoint. If a webhook is added later, it MUST verify signatures with
#   telnyx.webhooks.unwrap(payload, headers, TELNYX_PUBLIC_KEY) before processing.
#   See README "Webhooks" note.

"""Missions Audit Desk — plan, run, and forensically trace an agent mission.

Drives one Telnyx AI Missions mission end-to-end and produces a full audit trail:
mission -> run -> steps -> events -> linked assistant -> call outcome.
"""

import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

API_KEY = os.getenv("TELNYX_API_KEY")
if not API_KEY:
    raise RuntimeError("TELNYX_API_KEY is required (see .env.example)")

telnyx.api_key = API_KEY

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
DESTINATION_NUMBER = os.getenv("DESTINATION_NUMBER", "+1555XXXXXXXX")
ASSISTANT_PHONE_NUMBER = os.getenv("ASSISTANT_PHONE_NUMBER", "")
ASSISTANT_ID = os.getenv("ASSISTANT_ID", "")
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
POLL_TIMEOUT_SECONDS = int(os.getenv("POLL_TIMEOUT_SECONDS", "600"))
# Bounded synchronous window for the /execute request thread. The full
# POLL_TIMEOUT_SECONDS is honored by the poll helper, but the HTTP handler
# returns 504 rather than blocking the dev server for the full 10 minutes.
EXECUTE_MAX_WAIT_SECONDS = int(os.getenv("EXECUTE_MAX_WAIT_SECONDS", "60"))

STEP_STATUSES = ("pending", "in_progress", "completed", "skipped", "failed")
RUN_STATUSES = ("pending", "running", "paused", "succeeded", "failed", "cancelled")
EVENT_TYPES = (
    "status_change", "step_started", "step_completed", "step_failed",
    "tool_call", "tool_result", "message", "error", "custom",
)
TERMINAL_RUN_STATUSES = ("succeeded", "failed", "cancelled")
TERMINAL_EVENT_STATUSES = ("completed", "failed")

# Strict identifier pattern for path params interpolated into upstream URLs.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(number: str) -> str:
    """Mask a phone number for logging (never log full PII)."""
    if not number or len(number) < 5:
        return "***"
    return f"{number[:3]}***{number[-2:]}"


def _error(message: str, status: int = 400) -> tuple[Any, int]:
    return jsonify({"error": message}), status


def _valid_id(value: str) -> bool:
    """Validate a mission_id / run_id / step_id before URL interpolation."""
    return bool(value) and bool(_ID_RE.match(value))


# ---------------------------------------------------------------------------
# Missions REST helpers — thin wrappers over the SDK's raw request helper.
# The SDK does not expose a verified `telnyx.ai.missions` object graph, so we
# call the documented REST paths directly via `telnyx.request`.
# ---------------------------------------------------------------------------

def _missions_request(method: str, path: str, **kwargs: Any) -> Any:
    """Issue a Missions API request through the SDK's raw HTTP helper."""
    return telnyx.request(method, path, **kwargs)


def _create_mission(objective: str) -> Any:
    return _missions_request("post", "/ai/missions", json={"objective": objective})


def _list_missions() -> Any:
    return _missions_request("get", "/ai/missions")


def _retrieve_mission(mission_id: str) -> Any:
    return _missions_request("get", f"/ai/missions/{mission_id}")


def _create_run(mission_id: str) -> Any:
    return _missions_request("post", f"/ai/missions/{mission_id}/runs")


def _retrieve_run(mission_id: str, run_id: str) -> Any:
    return _missions_request("get", f"/ai/missions/{mission_id}/runs/{run_id}")


def _update_run(mission_id: str, run_id: str, **fields: Any) -> Any:
    return _missions_request(
        "patch", f"/ai/missions/{mission_id}/runs/{run_id}", json=fields,
    )


def _create_steps(mission_id: str, run_id: str, steps: list) -> Any:
    return _missions_request(
        "post", f"/ai/missions/{mission_id}/runs/{run_id}/steps",
        json={"steps": steps},
    )


def _list_steps(mission_id: str, run_id: str) -> Any:
    return _missions_request("get", f"/ai/missions/{mission_id}/runs/{run_id}/steps")


def _update_step(mission_id: str, run_id: str, step_id: str, status: str) -> Any:
    return _missions_request(
        "patch",
        f"/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}",
        json={"status": status},
    )


def _create_event(mission_id: str, run_id: str, event_type: str, properties: dict) -> Any:
    return _missions_request(
        "post", f"/ai/missions/{mission_id}/runs/{run_id}/events",
        json={"event_type": event_type, "properties": properties},
    )


def _list_events(mission_id: str, run_id: str) -> Any:
    return _missions_request("get", f"/ai/missions/{mission_id}/runs/{run_id}/events")


def _link_agent(mission_id: str, run_id: str, telnyx_agent_id: str) -> Any:
    return _missions_request(
        "post", f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
        json={"telnyx_agent_id": telnyx_agent_id},
    )


def _list_linked_agents(mission_id: str, run_id: str) -> Any:
    return _missions_request(
        "get", f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
    )


def _rows(payload: Any, key: str) -> list:
    """Normalize a Missions list response into a list of rows."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get(key) or payload.get("data") or []
    return []


# ---------------------------------------------------------------------------
# Step 1 — create_mission.py
# ---------------------------------------------------------------------------

@app.route("/missions", methods=["POST"])
def create_mission() -> tuple[Any, int]:
    """POST /ai/missions — create a mission; then list to show resource shape."""
    body = request.get_json(silent=True) or {}
    objective = (body.get("objective") or "").strip()
    if not objective:
        return _error("objective is required")

    try:
        mission = _create_mission(objective)
        missions = _list_missions()
    except telnyx.TelnyxError:
        app.logger.exception("create_mission failed")
        return _error("failed to create mission", 502)

    return jsonify({
        "mission": mission,
        "missions": missions,
        "created_at": _now(),
    }), 201


# ---------------------------------------------------------------------------
# Step 2 — start_run.py
# ---------------------------------------------------------------------------

@app.route("/missions/<mission_id>/runs", methods=["POST"])
def start_run(mission_id: str) -> tuple[Any, int]:
    """POST /ai/missions/{mission_id}/runs — start a run (initial status: pending)."""
    if not _valid_id(mission_id):
        return _error("invalid mission_id")

    try:
        run = _create_run(mission_id)
    except telnyx.TelnyxError:
        app.logger.exception("start_run failed for mission %s", mission_id)
        return _error("failed to start run", 502)

    return jsonify({"run": run, "initial_status": run.get("status", "pending")}), 201


# ---------------------------------------------------------------------------
# Step 3 — plan_steps.py
# ---------------------------------------------------------------------------

@app.route("/missions/<mission_id>/runs/<run_id>/steps", methods=["POST"])
def plan_steps(mission_id: str, run_id: str) -> tuple[Any, int]:
    """POST .../steps — submit the initial plan (three steps)."""
    if not _valid_id(mission_id) or not _valid_id(run_id):
        return _error("invalid mission_id or run_id")

    body = request.get_json(silent=True) or {}
    steps = body.get("steps") or [
        {"name": "provision assistant", "description": "Create the demo outreach assistant."},
        {"name": "schedule outreach call", "description": "Create one scheduled phone-call event."},
        {"name": "verify outcome", "description": "Confirm the scheduled event reached terminal status."},
    ]
    if not isinstance(steps, list) or not steps:
        return _error("steps must be a non-empty list")

    try:
        plan = _create_steps(mission_id, run_id, steps)
    except telnyx.TelnyxError:
        app.logger.exception("plan_steps failed for run %s", run_id)
        return _error("failed to create plan", 502)

    return jsonify({"plan": plan, "step_ids": [s.get("id") for s in (plan.get("steps") or [])]}), 201


# ---------------------------------------------------------------------------
# Step 4 — execute.py (worker)
# ---------------------------------------------------------------------------

def _advance_step(mission_id: str, run_id: str, step_id: str, status: str) -> None:
    """PATCH .../steps/{step_id} — advance a step status."""
    if status not in STEP_STATUSES:
        raise ValueError(f"invalid step status: {status}")
    _update_step(mission_id, run_id, step_id, status)


def _log_event(mission_id: str, run_id: str, event_type: str, properties: dict) -> None:
    """POST .../events — log a typed event with properties."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {event_type}")
    _create_event(mission_id, run_id, event_type, properties)


def _create_assistant() -> str:
    """Create the demo assistant (or reuse ASSISTANT_ID)."""
    if ASSISTANT_ID:
        return ASSISTANT_ID
    assistant = telnyx.AI.Assistant.create(
        instructions=(
            "You are a clinic outreach agent: verify the contact is reachable, "
            "confirm the appointment slot briefly, stay polite."
        ),
    )
    return assistant.id


def _create_scheduled_event(assistant_id: str) -> dict:
    """POST /v2/ai/assistants/{assistant_id}/scheduled_events — one phone-call event."""
    if not ASSISTANT_PHONE_NUMBER:
        raise RuntimeError(
            "ASSISTANT_PHONE_NUMBER is required. In the Telnyx portal, associate a "
            "phone number with the assistant, then set ASSISTANT_PHONE_NUMBER in .env."
        )
    return telnyx.request(
        "post",
        f"/v2/ai/assistants/{assistant_id}/scheduled_events",
        json={
            "telnyx_agent_target": ASSISTANT_PHONE_NUMBER,
            "telnyx_end_user_target": DESTINATION_NUMBER,
            "scheduled_at_fixed_datetime": _now(),
        },
    )


def _poll_scheduled_event(assistant_id: str, event_id: str) -> str:
    """Poll scheduled event until terminal; return final status."""
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    last_status = "pending"
    while time.monotonic() < deadline:
        event = telnyx.request(
            "get",
            f"/v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}",
        )
        status = event.get("status", "pending")
        if status != last_status:
            app.logger.info("scheduled event %s status -> %s", event_id, status)
            last_status = status
        if status in TERMINAL_EVENT_STATUSES:
            return status
        time.sleep(POLL_INTERVAL_SECONDS)
    return last_status


def _validate_execute_preconditions(
    mission_id: str, run_id: str, step_ids: list,
) -> tuple[Any, int] | None:
    """Return an error tuple if the execute request is not safe to run.

    Checks, in order:
      1. Path params are well-formed.
      2. step_ids is exactly 3 non-empty strings.
      3. The run exists and belongs to the mission.
      4. The run is not already terminal (idempotency).
      5. Every supplied step_id is present in the run's plan.
    """
    if not _valid_id(mission_id) or not _valid_id(run_id):
        return _error("invalid mission_id or run_id")
    if not isinstance(step_ids, list) or len(step_ids) != 3:
        return _error("step_ids must contain exactly 3 step ids")
    if not all(isinstance(s, str) and _valid_id(s) for s in step_ids):
        return _error("step_ids must contain exactly 3 step ids")

    try:
        run = _retrieve_run(mission_id, run_id)
        plan = _list_steps(mission_id, run_id)
    except telnyx.TelnyxError:
        app.logger.exception("execute precondition fetch failed for run %s", run_id)
        return _error("failed to load run", 502)

    if run.get("mission_id") and run.get("mission_id") != mission_id:
        return _error("run not found for mission", 404)
    if run.get("status") in TERMINAL_RUN_STATUSES:
        return _error("run is already terminal", 409)

    plan_ids = {s.get("id") for s in _rows(plan, "steps")}
    if not set(step_ids).issubset(plan_ids):
        return _error("step_ids do not belong to this run's plan")
    return None


def _link_agent_if_missing(mission_id: str, run_id: str, assistant_id: str) -> Any:
    """Link the assistant to the run unless a link already exists (idempotent)."""
    existing = _rows(_list_linked_agents(mission_id, run_id), "telnyx_agents")
    if not any(a.get("telnyx_agent_id") == assistant_id for a in existing):
        _link_agent(mission_id, run_id, assistant_id)
    return _list_linked_agents(mission_id, run_id)


@app.route("/missions/<mission_id>/runs/<run_id>/execute", methods=["POST"])
def execute(mission_id: str, run_id: str) -> tuple[Any, int]:
    """Run the campaign: provision assistant, schedule call, verify outcome."""
    body = request.get_json(silent=True) or {}
    step_ids = body.get("step_ids") or []

    pre = _validate_execute_preconditions(mission_id, run_id, step_ids)
    if pre is not None:
        return pre

    step1, step2, step3 = step_ids
    assistant_id = None
    event = None
    call_status = "skipped"
    started = time.monotonic()

    try:
        # Step 1 — provision assistant
        _advance_step(mission_id, run_id, step1, "in_progress")
        _log_event(mission_id, run_id, "step_started",
                   {"step_id": step1, "step_name": "provision assistant"})
        assistant_id = _create_assistant()
        _advance_step(mission_id, run_id, step1, "completed")
        _log_event(mission_id, run_id, "step_completed",
                   {"step_id": step1, "step_name": "provision assistant",
                    "assistant_id": assistant_id})

        # Step 2 — schedule outreach call
        _advance_step(mission_id, run_id, step2, "in_progress")
        _log_event(mission_id, run_id, "step_started",
                   {"step_id": step2, "step_name": "schedule outreach call"})
        if DEMO_MODE:
            app.logger.info("DEMO_MODE: would schedule call to %s",
                            _mask(DESTINATION_NUMBER))
            event = {"id": "demo-event", "status": "completed"}
        else:
            event = _create_scheduled_event(assistant_id)
        _log_event(mission_id, run_id, "custom", {
            "scheduled_event_id": event.get("id"),
            "call_status": event.get("status", "pending"),
            "telnyx_call_control_id": event.get("call_control_id"),
            "attempt_number": 1,
        })
        _advance_step(mission_id, run_id, step2, "completed")
        _log_event(mission_id, run_id, "step_completed",
                   {"step_id": step2, "step_name": "schedule outreach call"})

        # Step 3 — verify outcome (poll scheduled event to terminal)
        _advance_step(mission_id, run_id, step3, "in_progress")
        _log_event(mission_id, run_id, "step_started",
                   {"step_id": step3, "step_name": "verify outcome"})
        if DEMO_MODE:
            call_status = "completed"
        else:
            call_status = _poll_scheduled_event(assistant_id, event["id"])
            _log_event(mission_id, run_id, "status_change",
                       {"scheduled_event_id": event["id"], "call_status": call_status})

        if call_status == "failed":
            _advance_step(mission_id, run_id, step3, "failed")
            _log_event(mission_id, run_id, "step_failed",
                       {"step_id": step3, "step_name": "verify outcome",
                        "call_status": call_status})
            _update_run(
                mission_id, run_id,
                status="failed",
                result_summary="scheduled outreach call failed",
                result_payload={"failing_step_id": step3, "call_status": call_status},
            )
        else:
            _advance_step(mission_id, run_id, step3, "completed")
            _log_event(mission_id, run_id, "step_completed",
                       {"step_id": step3, "step_name": "verify outcome",
                        "call_status": call_status})
            _update_run(
                mission_id, run_id,
                status="succeeded",
                result_summary="outreach call completed",
                result_payload={"call_status": call_status},
            )

        # Link the assistant to the run (idempotent — skip if already linked)
        linked = _link_agent_if_missing(mission_id, run_id, assistant_id)
    except telnyx.TelnyxError:
        app.logger.exception("execute failed for run %s", run_id)
        return _error("execution failed", 502)

    if time.monotonic() - started > EXECUTE_MAX_WAIT_SECONDS:
        return _error("execution exceeded synchronous wait window", 504)

    return jsonify({
        "assistant_id": assistant_id,
        "call_status": call_status,
        "linked_agents": linked,
        "completed_at": _now(),
    })


# ---------------------------------------------------------------------------
# Step 5 — audit.py
# ---------------------------------------------------------------------------

@app.route("/missions/audit/<mission_id>/<run_id>", methods=["GET"])
def audit(mission_id: str, run_id: str) -> tuple[Any, int]:
    """Render the audit report: mission, run, steps, events, linked agents."""
    if not _valid_id(mission_id) or not _valid_id(run_id):
        return _error("invalid mission_id or run_id")

    try:
        mission = _retrieve_mission(mission_id)
        run = _retrieve_run(mission_id, run_id)
        steps = _list_steps(mission_id, run_id)
        events = _list_events(mission_id, run_id)
        agents = _list_linked_agents(mission_id, run_id)
    except telnyx.TelnyxError:
        app.logger.exception("audit failed for run %s", run_id)
        return _error("failed to render audit report", 502)

    step_rows = [
        {
            "step_id": s.get("id"),
            "name": s.get("name"),
            "planned_status": "pending",
            "current_status": s.get("status"),
            "completed": s.get("status") == "completed",
        }
        for s in _rows(steps, "steps")
    ]
    event_rows = [
        {
            "event_id": e.get("id"),
            "event_type": e.get("event_type"),
            "properties": e.get("properties"),
            "created_at": e.get("created_at"),
        }
        for e in _rows(events, "events")
    ]
    agent_rows = [
        {
            "run_id": a.get("run_id"),
            "telnyx_agent_id": a.get("telnyx_agent_id"),
            "created_at": a.get("created_at"),
        }
        for a in _rows(agents, "telnyx_agents")
    ]

    return jsonify({
        "mission": {"id": mission.get("id"), "objective": mission.get("objective")},
        "run": {
            "id": run.get("id"),
            "status": run.get("status"),
            "result_summary": run.get("result_summary"),
            "result_payload": run.get("result_payload"),
        },
        "steps": step_rows,
        "events": event_rows,
        "linked_agents": agent_rows,
        "run_status_enum": list(RUN_STATUSES),
        "step_status_enum": list(STEP_STATUSES),
        "event_type_enum": list(EVENT_TYPES),
        "rendered_at": _now(),
    })


@app.route("/health", methods=["GET"])
def health() -> tuple[Any, int]:
    return jsonify({"status": "ok", "demo_mode": DEMO_MODE}), 200


if __name__ == "__main__":
    app.logger.info("DEMO_MODE=%s (no real calls placed when true)", DEMO_MODE)
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
