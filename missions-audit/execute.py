"""Step 4 — run the campaign and record the audit trail.

For each step: PATCH .../steps/{step_id} to advance status, then
POST .../events to log a typed EventType with properties. The worker also
mirrors every scheduled-event status change it observes (honesty contract).

Worker primitives (all raw REST — the Missions surface AND the assistant
surface are untyped in the shipped SDK, so we call REST directly):
  * POST /ai/assistants                                        (create assistant)
  * POST /ai/assistants/{assistant_id}/scheduled_events        (schedule call)
  * GET  /ai/assistants/{assistant_id}/scheduled_events/{id}   (poll)

Demo mode (DEMO_MODE=true, the default) is a real guardrail: no scheduled
event is created and no call is placed. The worker does NOT fabricate a
platform status. Step 2 is marked `skipped` with an explicit `custom` event
carrying `demo_mode: true`, and no `status_change` event is emitted for a
synthetic event id. The honesty contract holds: the ledger only records
platform responses that actually happened.
"""
from __future__ import annotations

import argparse
import os
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


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _mask(number: str | None) -> str:
    if not number or len(number) < 5:
        return "***"
    return f"{number[:2]}***{number[-2:]}"


def update_step(mission_id: str, run_id: str, step_id: str, status: str) -> dict:
    """PATCH .../steps/{step_id} — advance a step status."""
    resp = requests.patch(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}",
        headers=_headers(),
        json={"status": status},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def log_event(mission_id: str, run_id: str, event_type: str, properties: dict) -> dict:
    """POST .../events — log a typed event with properties."""
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/events",
        headers=_headers(),
        json={"event_type": event_type, "properties": properties},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def update_run(mission_id: str, run_id: str, status: str, summary: str) -> dict:
    """PATCH .../runs/{run_id} — set terminal status + result_summary."""
    resp = requests.patch(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}",
        headers=_headers(),
        json={"status": status, "result_summary": summary},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def link_agent(mission_id: str, run_id: str, assistant_id: str) -> dict:
    """POST .../runs/{run_id}/telnyx-agents — link the assistant to the run."""
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
        headers=_headers(),
        json={"telnyx_agent_id": assistant_id},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def list_linked_agents(mission_id: str, run_id: str) -> list[dict]:
    """GET .../runs/{run_id}/telnyx-agents — linkage rows."""
    resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _create_assistant() -> str:
    """POST /ai/assistants — create the demo assistant (raw REST, untyped surface)."""
    existing = os.getenv("ASSISTANT_ID")
    if existing:
        print(f"Using ASSISTANT_ID from env: {existing}")
        return existing
    resp = requests.post(
        f"{API_BASE}/ai/assistants",
        headers=_headers(),
        json={"name": "Clinic Outreach Agent", "instructions": INSTRUCTIONS},
        timeout=30,
    )
    resp.raise_for_status()
    assistant_id = resp.json().get("data", {}).get("id")
    print(f"Created assistant: {assistant_id}")
    return assistant_id


def _create_scheduled_event(assistant_id: str, destination: str) -> dict:
    """POST .../scheduled_events — schedule the outreach call.

    Live mode only. In DEMO_MODE this function is never called; the caller
    marks step 2 `skipped` and logs a `custom` event with `demo_mode: true`.
    """
    target = os.getenv("ASSISTANT_PHONE_NUMBER")
    if not target:
        raise SystemExit(
            "ASSISTANT_PHONE_NUMBER is not set. Associate a phone number with the assistant "
            "in the Telnyx Portal (AI → Assistants → Phone Numbers), then set "
            "ASSISTANT_PHONE_NUMBER in .env."
        )
    body = {
        "telnyx_agent_target": target,
        "telnyx_end_user_target": destination,
        "scheduled_at_fixed_datetime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    resp = requests.post(
        f"{API_BASE}/ai/assistants/{assistant_id}/scheduled_events",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def _extract_call_control_id(event: dict) -> str | None:
    """Read the call control id from the scheduled-event response.

    The scheduled-event response exposes the id at the top level as
    `telnyx_call_control_id`; the `call_attempts` array entries use the same
    field name. Fall back to the last attempt entry if the top-level field is
    absent. Documented in API.md → Worker primitives.
    """
    top = event.get("telnyx_call_control_id")
    if top:
        return top
    attempts = event.get("call_attempts") or []
    if attempts:
        return attempts[-1].get("telnyx_call_control_id")
    return None


def _poll_event(mission_id: str, run_id: str, assistant_id: str, event_id: str) -> str:
    """Poll the scheduled event until terminal; mirror EVERY observed change.

    Honesty contract: each observed status transition is logged as a
    `status_change` missions event, not just the terminal one. A poll
    timeout is logged as an explicit `error` event so the ledger can
    distinguish a real failure from a timeout.
    """
    deadline = time.time() + POLL_CAP_SECONDS
    last = None
    while time.time() < deadline:
        resp = requests.get(
            f"{API_BASE}/ai/assistants/{assistant_id}/scheduled_events/{event_id}",
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        status = resp.json().get("data", {}).get("status", "pending")
        if status != last:
            print(f"  observed scheduled-event status: {status}")
            log_event(
                mission_id, run_id, "status_change",
                {"scheduled_event_id": event_id, "status": status},
            )
            last = status
        if status in TERMINAL:
            return status
        time.sleep(POLL_INTERVAL)

    log_event(
        mission_id, run_id, "error",
        {"reason": "poll_timeout", "event_id": event_id, "cap_seconds": POLL_CAP_SECONDS},
    )
    print(f"  poll timeout after {POLL_CAP_SECONDS}s — logged error event")
    return "failed"


def _run_step(mission_id: str, run_id: str, step: dict, fn) -> tuple[bool, str]:
    """Advance one step pending → in_progress → completed|failed, logging events."""
    step_id, name = step.get("id"), step.get("name", "")
    update_step(mission_id, run_id, step_id, "in_progress")
    log_event(mission_id, run_id, "step_started", {"step_id": step_id, "step_name": name})
    try:
        detail = fn()
    except Exception as exc:  # noqa: BLE001 — surfaced to the ledger, not swallowed
        update_step(mission_id, run_id, step_id, "failed")
        log_event(
            mission_id, run_id, "step_failed",
            {"step_id": step_id, "step_name": name, "error": str(exc)[:200]},
        )
        return False, str(exc)
    update_step(mission_id, run_id, step_id, "completed")
    log_event(mission_id, run_id, "step_completed", {"step_id": step_id, "step_name": name})
    return True, detail


def _skip_step(mission_id: str, run_id: str, step: dict, reason: str) -> None:
    """Mark a step `skipped` and log a `custom` event explaining why."""
    step_id, name = step.get("id"), step.get("name", "")
    update_step(mission_id, run_id, step_id, "skipped")
    log_event(
        mission_id, run_id, "custom",
        {"step_id": step_id, "step_name": name, "skipped": True, "reason": reason},
    )


def _fail_step(mission_id: str, run_id: str, step: dict, error: str) -> None:
    """Mark a step `failed` and log a `step_failed` event."""
    step_id, name = step.get("id"), step.get("name", "")
    update_step(mission_id, run_id, step_id, "failed")
    log_event(
        mission_id, run_id, "step_failed",
        {"step_id": step_id, "step_name": name, "error": error[:200]},
    )


def _link_and_print(mission_id: str, run_id: str, assistant_id: str) -> None:
    """Link the assistant to the run, recording a linkage failure as an event."""
    try:
        link_agent(mission_id, run_id, assistant_id)
    except Exception as exc:  # noqa: BLE001 — recorded in the ledger, not swallowed
        print(f"WARNING: failed to link assistant to run: {exc}", file=sys.stderr)
        log_event(
            mission_id, run_id, "error",
            {"reason": "link_agent_failed", "telnyx_agent_id": assistant_id, "error": str(exc)[:200]},
        )
        return
    print("\nLinked agents:")
    for row in list_linked_agents(mission_id, run_id):
        print(f"  run_id={row.get('run_id')} agent={row.get('telnyx_agent_id')} at={row.get('created_at')}")


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Execute the mission campaign.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    destination = os.getenv("DESTINATION_NUMBER")
    if not destination:
        print("ERROR: DESTINATION_NUMBER is not set in .env.", file=sys.stderr)
        return 1

    mission_id, run_id = args.mission_id, args.run_id

    steps_resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/steps",
        headers=_headers(), timeout=30,
    )
    steps_resp.raise_for_status()
    steps = steps_resp.json().get("data", [])
    if len(steps) < 3:
        print("ERROR: expected 3 planned steps; run plan_steps.py first.", file=sys.stderr)
        return 1

    update_run(mission_id, run_id, "running", "Campaign started.")
    assistant_id = _create_assistant()
    ok, _ = _run_step(mission_id, run_id, steps[0], lambda: assistant_id)
    if not ok:
        update_run(mission_id, run_id, "failed", "Step 1 (provision assistant) failed.")
        return 1

    if DEMO_MODE:
        # Honest demo path: no scheduled event is created, no call is placed,
        # and no fabricated platform status is mirrored into the ledger.
        print(
            f"[DEMO] no scheduled event created — would call {_mask(destination)} "
            f"from {_mask(os.getenv('ASSISTANT_PHONE_NUMBER'))}"
        )
        _skip_step(mission_id, run_id, steps[1], "demo_mode: no real scheduled event created")
        log_event(
            mission_id, run_id, "custom",
            {
                "demo_mode": True,
                "scheduled_event_id": None,
                "note": "no real scheduled event created",
                "destination": _mask(destination),
            },
        )
        _skip_step(mission_id, run_id, steps[2], "demo_mode: nothing to verify")
        update_run(
            mission_id, run_id, "succeeded",
            "Demo mode: assistant provisioned; scheduled call skipped (no real call placed).",
        )
        _link_and_print(mission_id, run_id, assistant_id)
        print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
        return 0

    event: dict = {}

    def _schedule() -> str:
        nonlocal event
        event = _create_scheduled_event(assistant_id, destination)
        return event.get("id", "")

    ok, detail = _run_step(mission_id, run_id, steps[1], _schedule)
    if not ok:
        update_run(mission_id, run_id, "failed", "Step 2 (schedule outreach call) failed.")
        _link_and_print(mission_id, run_id, assistant_id)
        return 1

    event_id = event.get("id")
    final = _poll_event(mission_id, run_id, assistant_id, event_id)
    log_event(
        mission_id, run_id, "custom",
        {
            "scheduled_event_id": event_id,
            "call_status": final,
            "telnyx_call_control_id": _extract_call_control_id(event),
            "attempt_number": 1,
        },
    )

    if final == "failed":
        # The scheduled call is what failed — blame step 2, not step 3.
        _fail_step(mission_id, run_id, steps[1], f"scheduled event ended as {final}")
        _skip_step(mission_id, run_id, steps[2], "scheduled call failed; nothing to verify")
        update_run(
            mission_id, run_id, "failed",
            "Step 2 (schedule outreach call) failed: scheduled event ended as failed.",
        )
        _link_and_print(mission_id, run_id, assistant_id)
        print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
        return 1

    ok, detail = _run_step(mission_id, run_id, steps[2], lambda: final)
    if ok:
        update_run(mission_id, run_id, "succeeded", "Call campaign completed successfully.")
    else:
        update_run(mission_id, run_id, "failed", f"Step 3 (verify outcome) failed: {detail}")

    _link_and_print(mission_id, run_id, assistant_id)
    print(f"\nNext: python audit.py --mission-id {mission_id} --run-id {run_id}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(_main())
