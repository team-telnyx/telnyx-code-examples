"""Step 2 — start a run for the mission and print its initial status."""
from __future__ import annotations

import argparse
import os
from typing import Any

import telnyx

from telnyx_client import client, unwrap


def _start_run(client: telnyx.Telnyx, mission_id: str) -> dict[str, Any]:
    resp = client.post(f"/ai/missions/{mission_id}/runs", body={})
    return unwrap(resp)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Start a run for a mission.")
    parser.add_argument("--mission-id", default=os.getenv("MISSION_ID"), help="Mission ID.")
    args = parser.parse_args()

    if not args.mission_id:
        raise SystemExit("No mission id. Pass --mission-id or set MISSION_ID in .env.")

    c = client()
    run = _start_run(c, args.mission_id)
    run_id = run.get("id") or run.get("run_id")
    print(f"Started run: {run_id}")
    print(f"  mission_id: {args.mission_id}")
    print(f"  status:     {run.get('status', 'pending')}")
    print(f"\nNext: python plan_steps.py  (run_id={run_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
