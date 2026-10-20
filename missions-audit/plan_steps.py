"""Step 3 — submit the initial 3-step plan for the run."""
from __future__ import annotations

import argparse
import os
from typing import Any

import telnyx

from telnyx_client import client, unwrap

PLAN: list[dict[str, str]] = [
    {"name": "provision assistant", "description": "Create the clinic outreach assistant."},
    {"name": "schedule outreach call", "description": "Schedule one phone-call event."},
    {"name": "verify outcome", "description": "Confirm the call reached terminal status."},
]


def _plan_steps(client: telnyx.Telnyx, mission_id: str, run_id: str) -> list[dict[str, Any]]:
    resp = client.post(
        f"/ai/missions/{mission_id}/runs/{run_id}/steps",
        body={"steps": PLAN},
    )
    data = unwrap(resp)
    return data if isinstance(data, list) else data.get("steps", data.get("data", []))


def _main() -> int:
    parser = argparse.ArgumentParser(description="Submit the initial plan for a run.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args()

    if not args.mission_id or not args.run_id:
        raise SystemExit("Need --mission-id and --run-id (or MISSION_ID / RUN_ID in .env).")

    c = client()
    steps = _plan_steps(c, args.mission_id, args.run_id)
    print(f"Planned {len(steps)} steps for run {args.run_id}:")
    for step in steps:
        print(f"  - {step.get('id')}  {step.get('name')}  status={step.get('status', 'pending')}")
    print("\nNext: python execute.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
