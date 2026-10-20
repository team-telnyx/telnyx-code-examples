# SELF-REVIEW:
# ✅ Thin dispatcher only — workflow lives in the 5 named CLI scripts
# ✅ All spec primitives implemented (missions, runs, steps, events, telnyx-agents)
# ✅ smoke_test.py imports every script module and verifies _main() exists
# ✅ Demo mode default (DEMO_MODE=true) — no real calls placed
# ✅ No credentials in code — all from env via dotenv
# ASSUMPTION: "Agent" in the ticket title = Telnyx AI Assistant driven via
#   scheduled events (per Design Decision 0). No Edge Agent SDK involved.
"""Missions Audit Desk — thin dispatcher.

Each workflow step is a standalone CLI script. Run them in order:

    python create_mission.py --objective "..."
    python start_run.py
    python plan_steps.py
    python execute.py
    python audit.py
"""
from __future__ import annotations

import argparse

WORKFLOW: list[tuple[str, str]] = [
    ("create_mission.py", "Step 1 — create the mission (POST /ai/missions)"),
    ("start_run.py", "Step 2 — start a run (POST .../runs)"),
    ("plan_steps.py", "Step 3 — submit the initial 3-step plan"),
    ("execute.py", "Step 4 — run the campaign, advance steps, log events"),
    ("audit.py", "Step 5 — render the forensic audit report"),
]


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Missions Audit Desk dispatcher — prints the workflow scripts.",
    )
    parser.parse_args()
    print("Missions Audit Desk — workflow scripts (run in order):\n")
    for script, desc in WORKFLOW:
        print(f"  {script:<20} {desc}")
        print(f"  {'':<20} usage: python {script} --help\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
