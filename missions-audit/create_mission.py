"""Step 1 - create a mission and list missions to show the resource shape.

POST /ai/missions   (create, 201)
GET  /ai/missions   (list, paginated)

The mission is the durable objective: it persists across runs. Every
missions response is wrapped in a {"data": ...} envelope and identifies
resources by `mission_id` (not `id`).

Verified against the live API and the Missions OpenAPI spec
(https://developers.telnyx.com/api-reference/missions/create-mission):
CreateMissionRequest requires `name`; optional fields are `description`,
`model`, `instructions`, `execution_mode` (default "external") and
`metadata`.
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")

DEFAULT_NAME = "Clinic outreach audit"
DEFAULT_DESCRIPTION = "Verify 3 clinic contacts can be reached"
DEFAULT_INSTRUCTIONS = (
    "You are a clinic outreach agent: verify the contact is reachable, "
    "confirm the appointment slot briefly, stay polite."
)


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


def create_mission(
    name: str,
    description: str | None = None,
    instructions: str | None = None,
    execution_mode: str = "external",
) -> dict:
    """POST /ai/missions - create the durable objective."""
    payload: dict = {"name": name, "execution_mode": execution_mode}
    if description:
        payload["description"] = description
    if instructions:
        payload["instructions"] = instructions
    resp = requests.post(
        f"{API_BASE}/ai/missions", headers=_headers(), json=payload, timeout=30
    )
    _die_on_error(resp)
    return resp.json().get("data", {})


def list_missions(limit: int = 5) -> list[dict]:
    """GET /ai/missions - list missions (shows the resource shape)."""
    resp = requests.get(
        f"{API_BASE}/ai/missions",
        headers=_headers(),
        params={"page[size]": limit},
        timeout=30,
    )
    _die_on_error(resp)
    return resp.json().get("data", [])


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a Telnyx AI mission.")
    parser.add_argument("--name", default=DEFAULT_NAME, help="Mission name (required by the API).")
    parser.add_argument("--description", default=DEFAULT_DESCRIPTION, help="Objective text.")
    parser.add_argument("--instructions", default=DEFAULT_INSTRUCTIONS, help="Agent instructions.")
    parser.add_argument(
        "--execution-mode",
        default="external",
        choices=["external"],
        help="external = a worker script (like execute.py) drives the run.",
    )
    args = parser.parse_args(argv)

    mission = create_mission(args.name, args.description, args.instructions, args.execution_mode)
    mission_id = mission.get("mission_id")
    print(f"mission_id     : {mission_id}")
    print(f"name           : {mission.get('name')}")
    print(f"description    : {mission.get('description')}")
    print(f"execution_mode : {mission.get('execution_mode')}")
    print(f"created_at     : {mission.get('created_at')}")

    if not mission_id:
        print("ERROR: no mission_id returned.", file=sys.stderr)
        return 1

    print("\nRecent missions:")
    for row in list_missions():
        print(f"  {row.get('mission_id')}  {row.get('execution_mode', '?'):<10} {row.get('name', '')[:48]}")

    print(f"\nNext: python start_run.py --mission-id {mission_id}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
