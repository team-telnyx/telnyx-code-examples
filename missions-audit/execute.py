"""Step 4 - run the campaign and record the audit trail.

For each step: PATCH .../plan/steps/{step_id} to advance the status, then
POST .../events to log a typed event. The worker also mirrors every
scheduled-event status change it observes (honesty contract).

Worker primitives (raw REST; note the two envelope conventions):
  * POST /ai/assistants                                        (create assistant, 200, BARE response)
  * POST /ai/assistants/{assistant_id}/scheduled_events        (schedule call, 201, BARE response)
  * GET  /ai/assistants/{assistant_id}/scheduled_events/{id}   (poll, 200, BARE response)

Envelope convention (verified against the live API):
  - Missions endpoints wrap responses in {"data": ...} and identify
    resources by mission_id / run_id / step_id / event_id.
  - Assistants and scheduled-events endpoints return the object bare
    (no envelope); the scheduled event id is `scheduled_event_id`.

Honesty contract: the ledger records the platform's responses, not the
worker's inference. Demo mode (DEMO_MODE=true, the default) creates no
assistant and places no call - every event it logs describes a simulated
walk, never a platform outcome. In live mode, a poll timeout or poll
error is logged as an `error` event and the verify step fails with the
worker-side reason; the call outcome itself is only ever reported from
the scheduled-event API's own status/call_status fields.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in {"1", "true", "yes"}
POLL_INTERVAL = 5
POLL_CAP_SECONDS = 600
TERMINAL = {"completed", "failed"}

INSTRUCTIONS = (
    "You are a clinic outreach agent: verify the contact is reachable, "
    "confirm the appointment slot briefly, stay polite."
)

E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit(
            "TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in."
        )
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _die_on_error(resp: requests.Response) -> None:
    if not resp.ok:
        try:
            errors = resp.json().get("errors", [])
            detail = "; ".join(
                str(e.get("code")) + ": " + str(e.get("title") or e.get("detail"))
                for e in errors
            )
        except Exception:
            detail = resp.text[:200]
        raise SystemExit(
            f"HTTP {resp.status_code} {resp.request.method} {resp.request.url}: {detail or resp.reason}"
        )


def _mask(number: str | None) -> str:
    if not number or len(number) < 5:
        return "***"
    return f"{number[:2]}***{number[-2:]}"


# ---------------------------------------------------------------------------
# Missions surface ({"data": ...} envelope)
# ---------------------------------------------------------------------------


def update_step(mission_id: str, run_id: str, step_id: str, status: str) -> dict:
    """PATCH .../plan/steps/{step_id} - advance a step status."""
    resp = requests.patch(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/plan/steps/{step_id}",
        headers=_headers(),
        json={"status": status},
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", {})


def log_event(
    mission_id: str,
    run_id: str,
    event_type: str,
    summary: str,
    step_id: str | None = None,
    payload: dict | None = None,
) -> dict:
    """POST .../events - log a typed event (type + summary required)."""
    body: dict = {"type": event_type, "summary": summary}
    if step_id:
        body["step_id"] = step_id
    if payload:
        body["payload"] = payload
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/events",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", {})


def update_run(
    mission_id: str,
    run_id: str,
    status: str | None = None,
    summary: str | None = None,
    payload: dict | None = None,
) -> dict:
    """PATCH .../runs/{run_id} - set status / result_summary / result_payload."""
    body: dict = {}
    if status:
        body["status"] = status
    if summary is not None:
        body["result_summary"] = summary
    if payload is not None:
        body["result_payload"] = payload
    resp = requests.patch(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", {})


def get_plan(mission_id: str, run_id: str) -> list[dict]:
    """GET .../plan - fetch the planned steps."""
    resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/plan",
        headers=_headers(),
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", [])


def link_agent(mission_id: str, run_id: str, assistant_id: str) -> dict:
    """POST .../runs/{run_id}/telnyx-agents - link the assistant to the run."""
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
        headers=_headers(),
        json={"telnyx_agent_id": assistant_id},
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", {})


def list_linked_agents(mission_id: str, run_id: str) -> list[dict]:
    """GET .../runs/{run_id}/telnyx-agents - linkage rows."""
    resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
        headers=_headers(),
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", [])


# ---------------------------------------------------------------------------
# Assistant / scheduled-event surface (BARE responses, no envelope)
# ---------------------------------------------------------------------------


def create_assistant() -> str:
    """POST /ai/assistants - create the demo assistant (200, bare response)."""
    resp = requests.post(
        f"{API_BASE}/ai/assistants",
        headers=_headers(),
        json={"name": "Clinic Outreach Agent", "instructions": INSTRUCTIONS},
        timeout=30,
    )
    _die_on_error(resp)
    assistant = resp.json()
    return assistant.get("id", "")


def create_scheduled_event(assistant_id: str, agent_target: str, end_user_target: str) -> dict:
    """POST .../scheduled_events - schedule the outreach call (201, bare response)."""
    body = {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_agent_target": agent_target,
        "telnyx_end_user_target": end_user_target,
        "scheduled_at_fixed_datetime": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        ),
    }
    resp = requests.post(
        f"{API_BASE}/ai/assistants/{assistant_id}/scheduled_events",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json()


def get_scheduled_event(assistant_id: str, event_id: str) -> dict:
    """GET .../scheduled_events/{event_id} - poll one scheduled event."""
    resp = requests.get(
        f"{API_BASE}/ai/assistants/{assistant_id}/scheduled_events/{event_id}",
        headers=_headers(),
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json()


def last_call_attempt(event: dict) -> dict | None:
    """Read the latest call_attempt entry from a scheduled-event response."""
    attempts = event.get("call_attempts") or []
    return attempts[-1] if attempts else None


# ---------------------------------------------------------------------------
# Worker steps
# ---------------------------------------------------------------------------


def _run_step(mission_id: str, run_id: str, step: dict, work) -> tuple[bool, object]:
    """Advance one step pending -> in_progress -> completed|failed, logging events."""
    step_id, description = step.get("step_id", ""), step.get("description", "")
    update_step(mission_id, run_id, step_id, "in_progress")
    log_event(mission_id, run_id, "step_started", f"Step {step_id} started", step_id)
    try:
        detail = work()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced to the ledger, not swallowed
        update_step(mission_id, run_id, step_id, "failed")
        log_event(
            mission_id,
            run_id,
            "step_failed",
            f"Step {step_id} failed: {exc}",
            step_id,
            {"error": str(exc)[:200]},
        )
        return False, str(exc)
    update_step(mission_id, run_id, step_id, "completed")
    log_event(mission_id, run_id, "step_completed", f"Step {step_id} completed", step_id)
    return True, detail


def _fail_step(mission_id: str, run_id: str, step: dict, error: str, payload: dict | None = None) -> None:
    """Mark a step `failed` and log a `step_failed` event."""
    step_id = step.get("step_id", "")
    update_step(mission_id, run_id, step_id, "failed")
    log_event(
        mission_id,
        run_id,
        "step_failed",
        f"Step {step_id} failed: {error}",
        step_id,
        {"error": error[:200], **(payload or {})},
    )


def _fail_run(mission_id: str, run_id: str, failing_step: str, reason: str, payload: dict | None = None) -> None:
    """Mark the run `failed` with a result_summary naming the failing step."""
    update_run(
        mission_id,
        run_id,
        status="failed",
        summary=f"Step ({failing_step}) failed: {reason}",
        payload=payload,
    )


def _poll_event(mission_id: str, run_id: str, assistant_id: str, event_id: str) -> tuple[str, str]:
    """Poll the scheduled event until terminal; mirror EVERY observed change.

    Honesty contract: each observed status transition is logged as a
    `status_change` missions event, not just the terminal one. A poll
    timeout or poll request failure is logged as an explicit `error`
    event - the ledger never records a platform outcome that the
    platform did not report. Returns (outcome, detail) where outcome is
    "completed" | "failed" | "timeout" | "error".
    """
    deadline = time.time() + POLL_CAP_SECONDS
    last = None
    while time.time() < deadline:
        try:
            event = get_scheduled_event(assistant_id, event_id)
        except SystemExit as exc:
            log_event(
                mission_id, run_id, "error",
                f"Poll request failed for scheduled event {event_id}",
                payload={"reason": "poll_request_failed", "error": str(exc)[:200]},
            )
            return "error", str(exc)
        status = event.get("status", "pending")
        if status != last:
            print(f"  observed scheduled-event status: {status}")
            log_event(
                mission_id,
                run_id,
                "status_change",
                f"Scheduled event observed: {status}",
                "schedule_outreach_call",
                {"scheduled_event_id": event_id, "status": status},
            )
            last = status
        if status in TERMINAL:
            return status, ""
        time.sleep(POLL_INTERVAL)

    log_event(
        mission_id,
        run_id,
        "error",
        f"Poll timed out after {POLL_CAP_SECONDS}s for scheduled event {event_id}",
        "verify_outcome",
        {
            "reason": "poll_timeout",
            "scheduled_event_id": event_id,
            "cap_seconds": POLL_CAP_SECONDS,
            "last_observed_status": last,
        },
    )
    print(f"  poll timeout after {POLL_CAP_SECONDS}s - logged error event")
    return "timeout", f"last observed status: {last}"


def _link_and_print(mission_id: str, run_id: str, assistant_id: str) -> None:
    """Link the assistant to the run, recording a linkage failure as an event."""
    try:
        link_agent(mission_id, run_id, assistant_id)
    except SystemExit as exc:
        print(f"WARNING: failed to link assistant to run: {exc}", file=sys.stderr)
        log_event(
            mission_id,
            run_id,
            "error",
            "Failed to link Telnyx agent to run",
            payload={"reason": "link_agent_failed", "telnyx_agent_id": assistant_id, "error": str(exc)[:200]},
        )
        return
    print("\nLinked agents:")
    for row in list_linked_agents(mission_id, run_id):
        print(
            f"  run_id={row.get('run_id')} telnyx_agent_id={row.get('telnyx_agent_id')} "
            f"created_at={row.get('created_at')}"
        )


def _demo_flow(mission_id: str, run_id: str, steps: list[dict]) -> int:
    """Walk the full missions ledger without any real side effects.

    Safe by default: no assistant is created, no scheduled event is
    created, no call is placed. Every step is walked pending ->
    in_progress -> completed so the demo exercises the same ledger
    mechanics as live mode; `skipped` is never used.
    """
    update_run(mission_id, run_id, status="running", summary="Demo campaign started.")

    for step in steps:
        ok, _ = _run_step(mission_id, run_id, step, lambda: None)
        if not ok:
            _fail_run(mission_id, run_id, step.get("step_id", "?"), "demo walk failed")
            return 1

    log_event(
        mission_id,
        run_id,
        "custom",
        "Demo mode note: simulated walk",
        payload={"demo_mode": True, "note": "no assistant created, no call placed"},
    )
    update_run(
        mission_id,
        run_id,
        status="succeeded",
        summary="Demo mode: missions ledger walked end-to-end; no assistant created and no call placed (DEMO_MODE=true).",
        payload={"demo_mode": True},
    )
    print("\n[DEMO] ledger walked end-to-end - no assistant created, no call placed.")
    print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
    return 0


def _live_flow(mission_id: str, run_id: str, steps: list[dict], destination: str) -> int:
    """Run the real campaign: assistant, scheduled call, poll, verify, link."""
    by_id = {s.get("step_id"): s for s in steps}

    update_run(mission_id, run_id, status="running", summary="Campaign started.")

    assistant_id = os.getenv("ASSISTANT_ID", "")
    if not assistant_id:
        print("Creating assistant...")
        assistant_id = create_assistant()
    else:
        print(f"Using ASSISTANT_ID from env: {assistant_id}")

    ok, _ = _run_step(mission_id, run_id, by_id["provision_assistant"], lambda: assistant_id)
    if not ok:
        _fail_run(mission_id, run_id, "provision_assistant", "assistant creation failed")
        return 1

    agent_target = os.getenv("ASSISTANT_PHONE_NUMBER")
    if not agent_target:
        raise SystemExit(
            "ASSISTANT_PHONE_NUMBER is not set. Associate a phone number with the assistant "
            "in the Telnyx Portal (AI > Assistants > Phone Numbers), then set "
            "ASSISTANT_PHONE_NUMBER in .env."
        )

    event: dict = {}

    def _schedule() -> str:
        nonlocal event
        event = create_scheduled_event(assistant_id, agent_target, destination)
        return event.get("scheduled_event_id", "")

    ok, detail = _run_step(mission_id, run_id, by_id["schedule_outreach_call"], _schedule)
    if not ok:
        _fail_run(mission_id, run_id, "schedule_outreach_call", str(detail))
        _link_and_print(mission_id, run_id, assistant_id)
        return 1

    event_id = event.get("scheduled_event_id")
    outcome, poll_detail = _poll_event(mission_id, run_id, assistant_id, event_id)

    attempt = last_call_attempt(event) or {}
    log_event(
        mission_id,
        run_id,
        "custom",
        f"Call attempt recorded ({outcome})",
        "schedule_outreach_call",
        {
            "scheduled_event_id": event_id,
            "call_status": outcome,
            "telnyx_call_control_id": attempt.get("telnyx_call_control_id"),
            "attempt_number": attempt.get("attempt_number", 1),
        },
    )

    verify_step = by_id["verify_outcome"]

    if outcome == "timeout":
        _fail_step(
            mission_id, run_id, verify_step,
            f"verification timed out after {POLL_CAP_SECONDS}s ({poll_detail})",
        )
        _fail_run(
            mission_id, run_id, "verify_outcome",
            f"poll timed out after {POLL_CAP_SECONDS}s ({poll_detail})",
            {"scheduled_event_id": event_id},
        )
        _link_and_print(mission_id, run_id, assistant_id)
        print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
        return 1

    if outcome == "error":
        _fail_step(mission_id, run_id, verify_step, f"worker could not observe scheduled event ({poll_detail})")
        _fail_run(
            mission_id, run_id, "verify_outcome",
            f"worker could not observe scheduled event ({poll_detail})",
            {"scheduled_event_id": event_id},
        )
        _link_and_print(mission_id, run_id, assistant_id)
        print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
        return 1

    # outcome in {"completed", "failed"} - reported by the platform itself.
    platform_call_status = attempt.get("call_status") or event.get("call_status")

    def _verify() -> str:
        print(f"  verifying scheduled event {event_id}: {outcome}")
        return outcome

    ok, _ = _run_step(mission_id, run_id, verify_step, _verify)
    if ok:
        update_run(
            mission_id,
            run_id,
            status="succeeded",
            summary=f"Call campaign completed successfully ({outcome}).",
            payload={
                "scheduled_event_id": event_id,
                "event_status": outcome,
                "call_status": platform_call_status,
                "telnyx_call_control_id": attempt.get("telnyx_call_control_id"),
                "assistant_id": assistant_id,
            },
        )
    else:
        _fail_run(
            mission_id, run_id, "verify_outcome",
            f"scheduled event ended as {outcome} (call_status: {platform_call_status})",
            {"scheduled_event_id": event_id, "event_status": outcome, "call_status": platform_call_status},
        )

    _link_and_print(mission_id, run_id, assistant_id)
    print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
    return 0 if ok else 1


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Execute the mission campaign.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    steps = get_plan(args.mission_id, args.run_id)
    if len(steps) < 3:
        print("ERROR: expected 3 planned steps; run plan_steps.py first.", file=sys.stderr)
        return 1

    destination = os.getenv("DESTINATION_NUMBER", "")
    if not DEMO_MODE:
        if not destination:
            print(
                "ERROR: DESTINATION_NUMBER is not set in .env (required for live mode).",
                file=sys.stderr,
            )
            return 1
        if not E164.match(destination):
            print(
                f"ERROR: DESTINATION_NUMBER {destination!r} is not a valid E.164 number "
                "(expected format: +<country code><number>, e.g. +15550001234).",
                file=sys.stderr,
            )
            return 1

    if DEMO_MODE:
        print("[DEMO] DEMO_MODE=true - walking the missions ledger with no side effects.")
        return _demo_flow(args.mission_id, args.run_id, steps)
    return _live_flow(args.mission_id, args.run_id, steps, destination)


if __name__ == "__main__":
    sys.exit(_main())
