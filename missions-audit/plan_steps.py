"""Step 3 — submit the initial plan: three steps for the call campaign.

POST /ai/missions/{mission_id}/runs/{run_id}/steps

Step status enum: pending | in_progress | completed | skipped | failed
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")

PLAN: list[dict] = [
    {"name": "Provision assistant", "description": "Create the clinic outreach assistant."},
    {"name": "Schedule outreach call", "description": "Create one scheduled phone-call event."},
    {"name": "Verify outcome", "description": "Confirm the scheduled event reached terminal status."},
]


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def create_plan(mission_id: str, run_id: str, steps: list[dict] | None = None) -> list[dict]:
    """POST .../steps — submit the initial plan."""
    body = {"steps": steps or PLAN}
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/steps",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json().get("data", [])
    return data if isinstance(data, list) else [data]


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Submit the initial mission plan.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    steps = create_plan(args.mission_id, args.run_id)
    print(f"Planned {len(steps)} steps:")
    for step in steps:
        print(f"  {step.get('id')}  {step.get('status', 'pending'):<12} {step.get('name', '')}")

    print(f"\nNext: python execute.py --mission-id {args.mission_id} --run-id {args.run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
