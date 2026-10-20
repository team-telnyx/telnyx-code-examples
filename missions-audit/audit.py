"""Step 5 - wait for terminal status and render the audit report.

GET /ai/missions/{mission_id}                        (mission detail)
GET /ai/missions/{mission_id}/runs/{run_id}          (run detail)
GET .../runs/{run_id}/plan                           (planned vs completed)
GET .../runs/{run_id}/events                         (event timeline)
GET .../runs/{run_id}/telnyx-agents                  (linked agents)

RunStatus enum: pending | running | paused | succeeded | failed | cancelled
StepStatus enum: pending | in_progress | completed | skipped | failed
EventType enum: status_change | step_started | step_completed | step_failed |
                tool_call | tool_result | message | error | custom
"""
from __future__ import annotations

import argparse
import json
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
    ("paused", "Run suspended; resume via POST .../runs/{run_id}/resume."),
    ("succeeded", "All steps completed."),
    ("failed", "A step failed; see result_summary."),
    ("cancelled", "Run cancelled via POST .../runs/{run_id}/cancel."),
]

STEP_STATUS_TABLE = [
    ("pending", "Planned, not started."),
    ("in_progress", "Worker is executing this step."),
    ("completed", "Step finished successfully."),
    ("skipped", "Step intentionally not run (not used by this demo)."),
    ("failed", "Step raised an error."),
]


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


def _get(path: str) -> dict:
    resp = requests.get(f"{API_BASE}{path}", headers=_headers(), timeout=30)
    _die_on_error(resp)
    return resp.json().get("data", {})


def wait_for_terminal(mission_id: str, run_id: str) -> tuple[dict, bool]:
    """Poll run detail until RunStatus is terminal (hard cap 10 minutes).

    Returns (run, reached_terminal). A timeout is reported explicitly so
    the caller can surface it instead of silently rendering a stale run.
    """
    deadline = time.time() + POLL_CAP_SECONDS
    run: dict = {}
    while time.time() < deadline:
        run = _get(f"/ai/missions/{mission_id}/runs/{run_id}")
        status = run.get("status", "pending")
        print(f"  run status: {status}")
        if status in TERMINAL:
            return run, True
        time.sleep(POLL_INTERVAL)
    return run, False


def _render(mission_id: str, run_id: str, run: dict) -> None:
    mission = _get(f"/ai/missions/{mission_id}")
    steps = _get(f"/ai/missions/{mission_id}/runs/{run_id}/plan")
    events = _get(f"/ai/missions/{mission_id}/runs/{run_id}/events")
    if not isinstance(events, list):
        events = [events]
    events = sorted(events, key=lambda e: e.get("timestamp", ""))
    agents = _get(f"/ai/missions/{mission_id}/runs/{run_id}/telnyx-agents")
    if not isinstance(agents, list):
        agents = [agents]

    print("\n" + "=" * 78)
    print("MISSIONS AUDIT REPORT")
    print("=" * 78)

    print("\n-- Mission --")
    print(f"mission_id     : {mission.get('mission_id')}")
    print(f"name           : {mission.get('name')}")
    print(f"description    : {mission.get('description')}")
    print(f"execution_mode : {mission.get('execution_mode')}")
    print(f"created_at     : {mission.get('created_at')}")

    print("\n-- Run --")
    print(f"run_id         : {run_id}")
    print(f"status         : {run.get('status')}")
    print(f"result_summary : {run.get('result_summary') or '(none)'}")
    print(f"result_payload : {json.dumps(run.get('result_payload')) if run.get('result_payload') else '(none)'}")
    print(f"error          : {run.get('error') or '(none)'}")
    print(f"started_at     : {run.get('started_at')}")
    print(f"finished_at    : {run.get('finished_at')}")

    print("\n-- Steps (planned vs completed) --")
    print(f"{'seq':<4} {'step_id':<26} {'status':<12} {'completed_at':<20} description")
    for step in sorted(steps, key=lambda s: s.get("sequence") or 0):
        print(
            f"{str(step.get('sequence', '')):<4} {str(step.get('step_id', '')):<26} "
            f"{step.get('status', '?'):<12} {str(step.get('completed_at') or '-'):<20} "
            f"{step.get('description', '')}"
        )

    print("\n-- Event timeline --")
    print(f"{'timestamp':<27} {'type':<15} {'step_id':<26} summary")
    for ev in events:
        step_id = ev.get("step_id") or "-"
        print(
            f"{str(ev.get('timestamp', '')):<27} {ev.get('type', '?'):<15} {step_id:<26} "
            f"{ev.get('summary', '')}"
        )
        payload = ev.get("payload")
        if payload:
            print(f"{'':<27} {'':<15} {'':<26} payload: {json.dumps(payload)}")

    print("\n-- Linked Telnyx agents --")
    for row in agents:
        print(
            f"  run_id={row.get('run_id')} telnyx_agent_id={row.get('telnyx_agent_id')} "
            f"created_at={row.get('created_at')}"
        )

    print("\n-- RunStatus enum --")
    for name, desc in RUN_STATUS_TABLE:
        print(f"  {name:<10} {desc}")
    print("\n-- StepStatus enum --")
    for name, desc in STEP_STATUS_TABLE:
        print(f"  {name:<12} {desc}")
    print("=" * 78)


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the mission audit report.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    parser.add_argument(
        "--nowait", action="store_true",
        help="Skip polling; render the run's current state immediately.",
    )
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    if args.nowait:
        run = _get(f"/ai/missions/{args.mission_id}/runs/{args.run_id}")
        terminal = run.get("status") in TERMINAL
    else:
        run, terminal = wait_for_terminal(args.mission_id, args.run_id)
        if not terminal:
            print(
                f"WARNING: poll cap of {POLL_CAP_SECONDS}s reached before the run reached a "
                f"terminal status (last status: {run.get('status')}). "
                "Re-run audit.py later to pick up the final state.",
                file=sys.stderr,
            )

    # Cross-check against a fresh GET before rendering (acceptance criterion).
    run = _get(f"/ai/missions/{args.mission_id}/runs/{args.run_id}")
    _render(args.mission_id, args.run_id, run)
    return 0 if terminal else 1


if __name__ == "__main__":
    sys.exit(_main())
