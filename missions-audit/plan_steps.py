"""Step 3 - submit the initial plan: three steps for the call campaign.

POST /ai/missions/{mission_id}/runs/{run_id}/plan   (create initial plan, 201)
GET  /ai/missions/{mission_id}/runs/{run_id}/plan   (fetch the plan)

Each CreatePlanStepRequest carries a client-chosen `step_id`, a
`description` and a `sequence` (all required; there is no separate
`name` field - the description is the human-readable label). Steps are
addressed later by that same `step_id` in PATCH .../plan/steps/{step_id}.

StepStatus enum: pending | in_progress | completed | skipped | failed
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
    {
        "step_id": "provision_assistant",
        "description": "Provision assistant - create the clinic outreach assistant.",
        "sequence": 1,
    },
    {
        "step_id": "schedule_outreach_call",
        "description": "Schedule outreach call - create one scheduled phone-call event.",
        "sequence": 2,
    },
    {
        "step_id": "verify_outcome",
        "description": "Verify outcome - confirm the scheduled event reached terminal status.",
        "sequence": 3,
    },
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


def get_plan(mission_id: str, run_id: str) -> list[dict]:
    """GET .../plan - fetch the current plan steps."""
    resp = requests.get(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/plan",
        headers=_headers(),
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", [])


def create_plan(
    mission_id: str, run_id: str, steps: list[dict] | None = None
) -> list[dict]:
    """POST .../plan - submit the initial plan."""
    resp = requests.post(
        f"{API_BASE}/ai/missions/{mission_id}/runs/{run_id}/plan",
        headers=_headers(),
        json={"steps": steps or PLAN},
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", [])


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Submit the initial mission plan.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"))
    parser.add_argument("--run-id", default=os.getenv("RUN_ID"))
    args = parser.parse_args(argv)

    if not args.mission_id or not args.run_id:
        print("ERROR: --mission-id and --run-id are required.", file=sys.stderr)
        return 1

    existing = get_plan(args.mission_id, args.run_id)
    if existing:
        print("Plan already exists on this run:")
        for step in existing:
            print(f"  {step.get('step_id')}  {step.get('status', 'pending'):<12} seq {step.get('sequence')}")
        print("\nNext: python execute.py --mission-id %s --run-id %s" % (args.mission_id, args.run_id))
        return 0

    steps = create_plan(args.mission_id, args.run_id)
    print(f"Planned {len(steps)} steps:")
    for step in steps:
        print(
            f"  {step.get('step_id')}  {step.get('status', 'pending'):<12} "
            f"seq {step.get('sequence')}  {step.get('description', '')}"
        )

    print(f"\nNext: python execute.py --mission-id {args.mission_id} --run-id {args.run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
