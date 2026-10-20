"""Step 5 — wait for terminal status and render the audit report.

GET /ai/missions/{mission_id}/runs/{run_id}          (run detail)
GET .../runs/{run_id}/steps                          (planned vs completed)
GET .../runs/{run_id}/events                         (event timeline)
GET .../runs/{run_id}/telnyx-agents                  (linked agents)

RunStatus enum: pending | running | paused | succeeded | failed | cancelled
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
TERMINAL = {"succeeded", "failed", "cancelled"}
POLL_INTERVAL = 5
POLL_CAP_SECONDS = 600

RUN_STATUS_TABLE = [
    ("pending", "Run created, no work started."),
    ("running", "Worker is executing steps."),
    ("paused", "Run suspended; resume via PATCH .../runs/{run_id}."),
    ("succeeded", "All steps completed."),
    ("failed", "A step failed; see result_summary."),
    ("cancelled", "Run cancelled by operator."),
]

STEP_STATUS_TABLE = [
    ("pending", "Planned, not started."),
    ("in_progress", "Worker is executing this step."),
    ("completed", "Step finished successfully."),
    ("skipped", "Step intentionally not run."),
    ("failed", "Step raised an error."),
]


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _get(path: str) -> dict:
    resp = requests.get(f"{API_BASE}{path}", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def wait_for_terminal(mission_id: str, run_id: str) -> dict:
    """Poll run detail until RunStatus is terminal (hard cap 10 minutes)."""
    deadline = time.time() + POLL_CAP_SECONDS
    run: dict = {}
    while time.time() < deadline:
        run = _get(f"/ai/missions/{mission_id}/runs/{run_id}")
        status = run.get("status", "pending")
        print(f"  run status: {status}")
        if status in TERMINAL:
            return run
        time.sleep(POLL_INTERVAL)
    return run


def _render(mission_id: str, run_id: str, run: dict) -> None:
    steps = _get(f"/ai/missions/{mission_id}/runs/{run_id}/steps")
    steps = steps if isinstance(steps, list) else [steps]
    events = _get(f"/ai/missions/{mission_id}/runs/{run_id}/events")
    events = events if isinstance(events, list) else [events]
    agents = _get(f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents")
    agents = agents if isinstance(agents, list) else [agents]

    print("\n" + "=" * 72)
    print("MISSIONS AUDIT REPORT")
    print("=" * 72)
    print(f"mission_id : {mission_id}")
    print(f"run_id     : {run_id}")
    print(f"status     : {run.get('status')}")
    print(f"summary    : {run.get('result_summary', '(none)')}")
    print(f"payload    : {run.get('result_payload', '(none)')}")

    print("\n-- Steps (planned vs completed) --")
    print(f"{'step_id':<38} {'status':<12} name")
    for step in steps:
        print(f"{str(step.get('id')):<38} {step.get('status', '?'):<12} {step.get('name', '')}")

    print("\n-- Event timeline --")
    for ev in sorted(events, key=lambda e: e.get("created_at", "")):
        print(f"{ev.get('created_at', '')}  {ev.get('event_type', '?'):<16} {ev.get('properties', {})}")

    print("\n-- Linked Telnyx agents --")
    for row in agents:
        print(f"run_id={row.get('run_id')} telnyx_agent_id={row.get('telnyx_agent_id')} created_at={row.get('created_at')}")

    print("\n-- RunStatus enum --")
    for name, desc in RUN_STATUS_TABLE:
        print(f"  {name:<10} {desc}")
    print("\n-- Step status enum --")
    for name, desc in STEP_STATUS_TABLE:
        print(f"  {name:<12} {desc}")
    print("=" * 72)


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the mission audit report.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    run = wait_for_terminal(args.mission_id, args.run_id)
    # Cross-check against a fresh GET before rendering (acceptance criterion).
    run = _get(f"/ai/missions/{args.mission_id}/runs/{args.run_id}")
    _render(args.mission_id, args.run_id, run)
    return 0 if run.get("status") in TERMINAL else 1


if __name__ == "__main__":
    sys.exit(_main())
