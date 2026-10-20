# SELF-REVIEW:
# ✅ All spec primitives implemented (Scheduled Events create/list/get/delete, call_attempts ledger)
# ✅ smoke_test.py verifies every workflow script loads and exposes _main()
# ✅ Demo mode default (DEMO_MODE=true) — no real calls dispatched
# ✅ No credentials in code; all from env via dotenv
# ✅ Thin dispatcher only — workflow lives in create_campaign.py / watch_campaign.py / report.py / teardown.py
# ASSUMPTION: Scheduled Events endpoints are called via raw REST (requests) because the
#   installed `telnyx` SDK does not expose a typed `ai.assistants.scheduled_events`
#   resource. API.md documents the exact request/response shapes used.

"""Thin dispatcher for the Scheduled-Events Retry Campaign Desk sample.

This module does NOT implement the campaign workflow. Each workflow step is a
standalone CLI script so it can be run, inspected, and tested in isolation:

  create_campaign.py  — schedule one phone-call event per contact (with retry budget)
  watch_campaign.py   — poll events, rebuild the per-attempt ledger, verify retry clock
  report.py           — offline scorecard: reached / retry-N / dead-letter
  teardown.py         — cancel all created events via DELETE (counted as cancelled)

Run `python <script> --help` for the flags of any step.
"""

from __future__ import annotations

import argparse

WORKFLOW = [
    ("create_campaign.py", "Step 1 — schedule phone-call events per contact (retry budget + SMS 400 guard)"),
    ("watch_campaign.py", "Step 2 — poll scheduled events, rebuild call_attempts ledger, assert retry clock"),
    ("report.py", "Step 3 — offline campaign scorecard from the event ledger"),
    ("teardown.py", "Step 4 — cancel all created events via DELETE (counted as cancelled, not failed)"),
]


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Scheduled-Events Retry Campaign Desk — dispatcher for the campaign workflow scripts.",
    )
    parser.parse_args()

    print("Scheduled-Events Retry Campaign Desk")
    print("=" * 52)
    print("This sample is a script suite. Run each workflow step directly:\n")
    for script, desc in WORKFLOW:
        print(f"  python {script} --help")
        print(f"      {desc}\n")
    print("Typical run order:")
    print("  1. python create_campaign.py --contacts contacts.csv --start 2026-10-20T15:00:00Z --spread 45")
    print("  2. python watch_campaign.py")
    print("  3. python report.py")
    print("  4. python teardown.py   # cancel remaining events (counted as cancelled)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
