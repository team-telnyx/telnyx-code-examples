"""Step 2 — start a run for a mission and print its initial status.

POST /ai/missions/{mission_id}/runs
GET  /ai/missions/{mission_id}/runs

RunStatus enum: pending | running | paused | succeeded | failed | cancelled
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def start_run(mission_id: str) -> dict:
    """POST /ai/missions/{mission_id}/runs — start one execution of the mission."""
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs", headers=_headers(), json={}, timeout=30
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def list_runs(mission_id: str) -> list[dict]:
    """GET /ai/missions/{mission_id}/runs — list runs for a mission."""
    resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs", headers=_headers(), timeout=30
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start a run for a mission.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"), help="Mission id.")
    args = parser.parse_args(argv)

    if not args.mission_id:
        print("ERROR: --mission-id (or MISSION_ID env) is required.", file=sys.stderr)
        return 1

    run = start_run(args.mission_id)
    run_id = run.get("id")
    print(f"run_id : {run_id}")
    print(f"status : {run.get('status', 'pending')}")

    print("\nRuns for this mission:")
    for row in list_runs(args.mission_id):
        print(f"  {row.get('id')}  {row.get('status', '?'):<10} {row.get('created_at', '')}")

    if not run_id:
        print("ERROR: no run id returned.", file=sys.stderr)
        return 1
    print(f"\nNext: python plan_steps.py --mission-id {args.mission_id} --run-id {run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
