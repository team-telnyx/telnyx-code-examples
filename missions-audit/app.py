# SELF-REVIEW:
# ✅ All spec primitives implemented (AI Missions create/run/steps/events/link, assistant + scheduled_events)
# ✅ smoke_test.py imports every workflow script and verifies _main() callables
# ✅ Demo mode default (DEMO_MODE=true) — no real calls placed unless explicitly enabled
# ✅ No credentials in code — all via env (dotenv)
# ✅ Missions endpoints are UNTYPED in the SDK → raw REST with Bearer auth (per API.md)
# ASSUMPTION: "Agent" in the ticket title = Telnyx AI Assistant (not Edge Agent SDK).
#   The demo places ONE call; the "3 contacts" objective is the mission objective string only.
"""Missions Audit Desk — thin dispatcher.

Each workflow step lives in its own standalone script. This file only
prints the menu and points you at the right script.
"""
from __future__ import annotations

import argparse
import sys

WORKFLOW: list[tuple[str, str]] = [
    ("create_mission.py", "Step 1 — create the mission (POST /ai/missions)"),
    ("start_run.py", "Step 2 — start a run (POST /ai/missions/{id}/runs)"),
    ("plan_steps.py", "Step 3 — submit the initial 3-step plan"),
    ("execute.py", "Step 4 — run the campaign, advance steps, log events, link assistant"),
    ("audit.py", "Step 5 — wait for terminal status and render the audit report"),
]


def _print_menu() -> None:
    print("Missions Audit Desk — workflow scripts\n")
    for name, desc in WORKFLOW:
        print(f"  python {name:<18} {desc}")
    print("\nRun each script with --help for its own options.")


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Missions Audit Desk dispatcher (workflow lives in the named scripts).",
    )
    parser.add_argument("--list", action="store_true", help="List the workflow scripts.")
    args = parser.parse_args(argv)

    _print_menu()
    if args.list:
        return 0
    print("\nTip: start with `python create_mission.py --objective \"...\"`")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
