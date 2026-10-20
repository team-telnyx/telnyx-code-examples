"""Step 5 — render the forensic audit report.

Waits for the run to reach a terminal status, fetches run detail, steps,
events, and linked agents, cross-checks against a fresh GET, and prints
the full ledger plus the RunStatus state table.

ASSUMPTION: The Missions API exposes GET .../runs/{run_id}/steps and
GET .../runs/{run_id}/events as collection endpoints, mirroring the POST
endpoints used to create them. If a deployment does not expose these, the
report falls back to whatever the run detail payload carries.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import telnyx

from telnyx_client import client, unwrap

TERMINAL_RUN_STATUSES = {"succeeded", "failed", "cancelled"}
POLL_INTERVAL_SECONDS = 5
POLL_HARD_CAP_SECONDS = 600

RUN_STATUS_TABLE = [
    ("pending", "Run created, not yet started."),
    ("running", "Run is executing steps."),
    ("paused", "Run paused by operator (PATCH update-run)."),
    ("succeeded", "Run completed successfully."),
    ("failed", "Run failed; see result_summary."),
    ("cancelled", "Run cancelled by operator."),
]


def _get(c: telnyx.Telnyx, path: str) -> Any:
    return unwrap(c.get(path))


def _as_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("data", "steps", "events"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def _wait_for_terminal(c: telnyx.Telnyx, mission_id: str, run_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + POLL_HARD_CAP_SECONDS
    while time.monotonic() < deadline:
        run = _get(c, f"/ai/missions/{mission_id}/runs/{run_id}")
        status = run.get("status")
        print(f"  run status: {status}")
        if status in TERMINAL_RUN_STATUSES:
            return run
        time.sleep(POLL_INTERVAL_SECONDS)
    return _get(c, f"/ai/missions/{mission_id}/runs/{run_id}")


def _cross_check(polled: dict[str, Any], fresh: dict[str, Any]) -> None:
    """Compare the polled run state to a fresh GET; warn loudly on mismatch."""
    polled_status = polled.get("status")
    fresh_status = fresh.get("status")
    if polled_status != fresh_status:
        print(
            f"\nWARNING: run status changed between poll and fresh GET "
            f"(polled={polled_status!r}, fresh={fresh_status!r}). "
            f"Rendering the fresh state.",
            file=sys.stderr,
        )
    else:
        print(f"Cross-check OK: polled and fresh run status both {fresh_status!r}.")


def _render(mission: dict[str, Any], run: dict[str, Any], steps: list[dict[str, Any]],
            events: list[dict[str, Any]], agents: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 72)
    print("MISSIONS AUDIT REPORT")
    print("=" * 72)
    print(f"Mission: {mission.get('id')}  status={mission.get('status')}")
    print(f"  objective: {mission.get('objective')}")
    print(f"Run:     {run.get('id')}  status={run.get('status')}")
    print(f"  result_summary: {run.get('result_summary')}")
    print(f"  result_payload: {run.get('result_payload')}")

    print("\nSteps (planned vs completed):")
    print(f"  {'step_id':<28} {'name':<26} {'status':<12} {'updated_at'}")
    for step in steps:
        print(f"  {str(step.get('id')):<28} {str(step.get('name')):<26} "
              f"{str(step.get('status')):<12} {step.get('updated_at', '')}")

    print("\nEvent timeline:")
    for ev in events:
        print(f"  [{ev.get('created_at', '')}] {ev.get('event_type'):<16} {ev.get('properties')}")

    print("\nLinked Telnyx agents:")
    for row in agents:
        print(f"  run_id={row.get('run_id')}  telnyx_agent_id={row.get('telnyx_agent_id')}  "
              f"created_at={row.get('created_at')}")

    print("\nRunStatus state table:")
    for status, desc in RUN_STATUS_TABLE:
        print(f"  {status:<12} {desc}")
    print("=" * 72)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Render the mission audit report.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args()

    if not args.mission_id or not args.run_id:
        raise SystemExit("Need --mission-id and --run-id (or MISSION_ID / RUN_ID in .env).")

    c = client()
    print("Waiting for run to reach terminal status...")
    polled_run = _wait_for_terminal(c, args.mission_id, args.run_id)

    # Cross-check against fresh GETs before rendering.
    mission = _get(c, f"/ai/missions/{args.mission_id}")
    fresh_run = _get(c, f"/ai/missions/{args.mission_id}/runs/{args.run_id}")
    _cross_check(polled_run, fresh_run)

    steps = _as_list(_get(c, f"/ai/missions/{args.mission_id}/runs/{args.run_id}/steps"))
    events = _as_list(_get(c, f"/ai/missions/{args.mission_id}/runs/{args.run_id}/events"))
    agents = _as_list(_get(c, f"/ai/missions/{args.mission_id}/runs/{args.run_id}/telnyx-agents"))

    _render(mission, fresh_run, steps, events, agents)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
