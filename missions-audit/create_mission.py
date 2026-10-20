"""Step 1 — create a mission and list missions to show the resource shape."""
from __future__ import annotations

import argparse
from typing import Any

import telnyx

from telnyx_client import client, unwrap

DEFAULT_OBJECTIVE = "Verify 3 clinic contacts can be reached"


def _create_mission(client: telnyx.Telnyx, objective: str) -> dict[str, Any]:
    resp = client.post("/ai/missions", body={"objective": objective})
    return unwrap(resp)


def _list_missions(client: telnyx.Telnyx) -> list[dict[str, Any]]:
    data = unwrap(client.get("/ai/missions"))
    return data if isinstance(data, list) else data.get("data", [])


def _main() -> int:
    parser = argparse.ArgumentParser(description="Create a Telnyx AI mission.")
    parser.add_argument("--objective", default=DEFAULT_OBJECTIVE, help="Mission objective text.")
    args = parser.parse_args()

    c = client()
    mission = _create_mission(c, args.objective)
    mission_id = mission.get("id") or mission.get("mission_id")
    print(f"Created mission: {mission_id}")
    print(f"  objective: {mission.get('objective')}")
    print(f"  status:    {mission.get('status')}")

    print("\nMissions (resource shape):")
    for m in _list_missions(c):
        print(f"  - {m.get('id')}  status={m.get('status')}  objective={m.get('objective')!r}")

    print(f"\nNext: python start_run.py  (mission_id={mission_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
