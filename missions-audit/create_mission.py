"""Step 1 — create a mission and list missions to show the resource shape.

POST /ai/missions   (create)
GET  /ai/missions   (list)

The Missions API is UNTYPED in the shipped `telnyx` SDK, so we call the
REST surface directly with a Bearer token and unwrap the {"data": ...}
envelope, exactly as documented in API.md.
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
DEFAULT_OBJECTIVE = "Verify 3 clinic contacts can be reached"


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise SystemExit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def create_mission(objective: str, name: str | None = None) -> dict:
    """POST /ai/missions — create the durable objective."""
    payload: dict = {"objective": objective}
    if name:
        payload["name"] = name
    resp = requests.post(f"{API_BASE}/ai/missions", headers=_headers(), json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def list_missions(limit: int = 5) -> list[dict]:
    """GET /ai/missions — list missions (shows the resource shape)."""
    resp = requests.get(
        f"{API_BASE}/ai/missions", headers=_headers(), params={"page[size]": limit}, timeout=30
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a Telnyx AI mission.")
    parser.add_argument("--objective", default=DEFAULT_OBJECTIVE, help="Mission objective string.")
    parser.add_argument("--name", default=None, help="Optional mission name.")
    args = parser.parse_args(argv)

    mission = create_mission(args.objective, args.name)
    mission_id = mission.get("id")
    print(f"mission_id: {mission_id}")
    print(f"objective : {mission.get('objective', args.objective)}")
    print(f"status    : {mission.get('status', 'unknown')}")

    print("\nRecent missions:")
    for row in list_missions():
        print(f"  {row.get('id')}  {row.get('status', '?'):<10} {row.get('objective', '')[:60]}")

    if not mission_id:
        print("ERROR: no mission id returned.", file=sys.stderr)
        return 1
    print(f"\nNext: python start_run.py --mission-id {mission_id}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
