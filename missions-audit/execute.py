"""Step 4 — run the campaign: create assistant, schedule one call, advance steps,
log typed events, and link the assistant to the run.

Honesty contract: EVERY state change observed (including each intermediate
scheduled-event status transition) is mirrored as a missions event.

Demo mode (DEMO_MODE=true, the default) is safe-by-default: no real assistant
is created and no real call is scheduled. Demo rows written into the missions
ledger use the sentinel prefix `DEMO:` so a reviewer replaying the audit trail
can immediately tell synthetic rows from real ones. The audit report labels
these rows as synthetic.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any, Callable

import telnyx

from telnyx_client import client, demo_mode, require_e164, unwrap

ASSISTANT_INSTRUCTIONS = (
    "You are a clinic outreach agent: verify the contact is reachable, "
    "confirm the appointment slot briefly, stay polite."
)
POLL_INTERVAL_SECONDS = 5
POLL_HARD_CAP_SECONDS = 600
TERMINAL_EVENT_STATUSES = {"completed", "failed"}

STEP_NAMES = ["provision assistant", "schedule outreach call", "verify outcome"]

# Sentinel prefix for identifiers written into the ledger in demo mode.
DEMO_PREFIX = "DEMO:"


class StepFailedError(RuntimeError):
    """Raised when a worker step fails; translated to SystemExit in _main()."""


def _patch_step(c: telnyx.Telnyx, mission_id: str, run_id: str, step_id: str, status: str) -> None:
    c.patch(f"/ai/missions/{mission_id}/runs/{run_id}/steps/{step_id}", body={"status": status})


def _log_event(
    c: telnyx.Telnyx, mission_id: str, run_id: str, event_type: str, properties: dict[str, Any]
) -> None:
    c.post(
        f"/ai/missions/{mission_id}/runs/{run_id}/events",
        body={"event_type": event_type, "properties": properties},
    )


def _patch_run(c: telnyx.Telnyx, mission_id: str, run_id: str, status: str, summary: str) -> None:
    c.patch(
        f"/ai/missions/{mission_id}/runs/{run_id}",
        body={"status": status, "result_summary": summary},
    )


def _create_assistant(c: telnyx.Telnyx) -> str:
    existing = os.getenv("ASSISTANT_ID")
    if existing:
        print(f"Reusing ASSISTANT_ID={existing}")
        return existing
    resp = c.post(
        "/ai/assistants",
        body={"name": "clinic-outreach", "instructions": ASSISTANT_INSTRUCTIONS},
    )
    assistant_id = unwrap(resp).get("id")
    print(f"Created assistant: {assistant_id}")
    return assistant_id


def _schedule_call(c: telnyx.Telnyx, assistant_id: str, destination: str, target: str) -> str:
    """Schedule one phone-call event.

    Field names verified against the scheduled-events API reference
    (concept 2 / AI Assistants scheduled_events):
      - event_type: "phone_call"
      - telnyx_agent_target: phone number associated with the assistant
      - telnyx_end_user_target: destination number
    """
    resp = c.post(
        f"/ai/assistants/{assistant_id}/scheduled_events",
        body={
            "event_type": "phone_call",
            "telnyx_agent_target": target,
            "telnyx_end_user_target": destination,
        },
    )
    return unwrap(resp).get("id")


def _poll_event(
    c: telnyx.Telnyx,
    assistant_id: str,
    event_id: str,
    on_transition: Callable[[str], None],
) -> str:
    """Poll the scheduled event to terminal status.

    Calls on_transition(status) for EVERY observed status change so the caller
    can mirror each transition into the missions ledger (honesty contract).

    On timeout, raises StepFailedError so the caller PATCHes the step to
    'failed' and logs step_failed — the ledger stays consistent.
    """
    deadline = time.monotonic() + POLL_HARD_CAP_SECONDS
    last: str | None = None
    while time.monotonic() < deadline:
        data = unwrap(c.get(f"/ai/assistants/{assistant_id}/scheduled_events/{event_id}"))
        status = data.get("status")
        if status != last:
            print(f"  observed scheduled-event status: {status}")
            on_transition(status)
            last = status
        if status in TERMINAL_EVENT_STATUSES:
            return status
        time.sleep(POLL_INTERVAL_SECONDS)
    raise StepFailedError(
        f"Scheduled event {event_id} did not reach terminal status within "
        f"{POLL_HARD_CAP_SECONDS}s (last observed: {last!r})."
    )


def _run_step(
    c: telnyx.Telnyx,
    mission_id: str,
    run_id: str,
    step_id: str,
    step_name: str,
    work_fn: Callable[[], Any],
) -> Any:
    """Encapsulate the pending -> in_progress -> completed|failed transition.

    On exception: PATCH the step to 'failed', log step_failed, PATCH the run to
    'failed' with a result_summary naming the step, then raise StepFailedError.
    """
    _patch_step(c, mission_id, run_id, step_id, "in_progress")
    _log_event(c, mission_id, run_id, "step_started", {"step_id": step_id, "step_name": step_name})
    try:
        result = work_fn()
    except Exception as exc:  # noqa: BLE001 — surface any worker failure into the ledger
        print(f"  step '{step_name}' failed: {exc}", file=sys.stderr)
        _patch_step(c, mission_id, run_id, step_id, "failed")
        _log_event(c, mission_id, run_id, "step_failed", {"step_id": step_id, "step_name": step_name})
        _patch_run(c, mission_id, run_id, "failed", f"Step '{step_name}' failed: {exc}")
        raise StepFailedError(f"Step '{step_name}' failed: {exc}") from exc
    _patch_step(c, mission_id, run_id, step_id, "completed")
    _log_event(c, mission_id, run_id, "step_completed", {"step_id": step_id, "step_name": step_name})
    return result


def _demo_verify(
    c: telnyx.Telnyx, mission_id: str, run_id: str, event_id: str
) -> str:
    """Demo-mode verification: simulate 2-3 status transitions and mirror each.

    Exercises the honesty contract (mirroring observed platform transitions)
    even without a real call.
    """
    for status in ("pending", "in_progress", "completed"):
        print(f"  [DEMO] observed scheduled-event status: {status}")
        _log_event(
            c, mission_id, run_id, "status_change",
            {"scheduled_event_id": event_id, "status": status},
        )
        time.sleep(0.1)
    return "completed"


def _main() -> int:
    parser = argparse.ArgumentParser(description="Execute the mission campaign.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    parser.add_argument("--step-ids", default=os.getenv("STEP_IDS"), help="Comma-separated step IDs.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Force live mode (overrides DEMO_MODE). Places a real scheduled call.",
    )
    args = parser.parse_args()

    if not args.mission_id or not args.run_id or not args.step_ids:
        raise SystemExit(
            "Need --mission-id, --run-id, --step-ids (or MISSION_ID/RUN_ID/STEP_IDS in .env)."
        )

    step_ids = [s.strip() for s in args.step_ids.split(",") if s.strip()]
    if len(step_ids) < 3:
        raise SystemExit(f"Expected 3 step IDs, got {len(step_ids)}: {step_ids}")

    demo = demo_mode() and not args.live
    print(f"DEMO_MODE={'true' if demo else 'false'}")

    destination = os.getenv("DESTINATION_NUMBER", "")
    target = os.getenv("ASSISTANT_PHONE_NUMBER", "")
    if not demo:
        require_e164(destination, "DESTINATION_NUMBER")
        require_e164(target, "ASSISTANT_PHONE_NUMBER")

    c = client()
    mission_id, run_id = args.mission_id, args.run_id

    try:
        # Step 1 — provision assistant
        if demo:
            assistant_id = f"{DEMO_PREFIX}assistant"
            print(f"[DEMO] would create assistant 'clinic-outreach' (using {assistant_id})")
            _run_step(c, mission_id, run_id, step_ids[0], STEP_NAMES[0], lambda: assistant_id)
        else:
            assistant_id = _run_step(c, mission_id, run_id, step_ids[0], STEP_NAMES[0],
                                     lambda: _create_assistant(c))

        # Step 2 — schedule outreach call
        if demo:
            event_id = f"{DEMO_PREFIX}scheduled-event"
            print(f"[DEMO] would schedule call to {destination or '<unset>'} from {target or '<unset>'}")
            _run_step(c, mission_id, run_id, step_ids[1], STEP_NAMES[1], lambda: event_id)
        else:
            event_id = _run_step(c, mission_id, run_id, step_ids[1], STEP_NAMES[1],
                                 lambda: _schedule_call(c, assistant_id, destination, target))
        print(f"Scheduled event: {event_id}")

        # Step 3 — verify outcome (poll for terminal status, mirroring every transition)
        def _verify() -> str:
            if demo:
                return _demo_verify(c, mission_id, run_id, event_id)

            def mirror(status: str) -> None:
                _log_event(c, mission_id, run_id, "status_change",
                           {"scheduled_event_id": event_id, "status": status})

            return _poll_event(c, assistant_id, event_id, mirror)

        final_status = _run_step(c, mission_id, run_id, step_ids[2], STEP_NAMES[2], _verify)

        # One custom event per call attempt, mirroring the scheduled-event call_attempts shape.
        # In live mode, extract the real call_control_id from the scheduled-event response.
        call_control_id: str | None = None
        if not demo:
            event_data = unwrap(c.get(f"/ai/assistants/{assistant_id}/scheduled_events/{event_id}"))
            attempts = event_data.get("call_attempts") or []
            if attempts:
                call_control_id = attempts[-1].get("telnyx_call_control_id")

        custom_props: dict[str, Any] = {
            "scheduled_event_id": event_id,
            "call_status": final_status,
            "attempt_number": 1,
        }
        if call_control_id is not None:
            custom_props["telnyx_call_control_id"] = call_control_id
        _log_event(c, mission_id, run_id, "custom", custom_props)

        if final_status == "completed":
            _patch_run(c, mission_id, run_id, "succeeded", "Call campaign completed.")
        else:
            _patch_run(c, mission_id, run_id, "failed",
                       f"Scheduled event {event_id} ended as {final_status}.")

        # Link assistant to run
        c.post(
            f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents",
            body={"telnyx_agent_id": assistant_id},
        )
        data = unwrap(c.get(f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents"))
        rows = data if isinstance(data, list) else data.get("data", [])
        print("\nLinked agents:")
        for row in rows:
            print(f"  run_id={row.get('run_id')}  telnyx_agent_id={row.get('telnyx_agent_id')}  "
                  f"created_at={row.get('created_at')}")
    except StepFailedError as exc:
        print(f"Campaign failed: {exc}", file=sys.stderr)
        return 1

    print("\nNext: python audit.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
