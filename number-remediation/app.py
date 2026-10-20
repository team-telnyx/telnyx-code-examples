"""Number Reputation Remediation Desk \u2014 thin dispatcher.

Each workflow step lives in its own script (see below). This file only
prints the menu and points at the right script. Run `python <script> --help`
for details on any step.
"""

import argparse
import sys

WORKFLOW = [
    ("check_reputation.py",
     "Step 1 \u2014 read enterprise reputation data, split flagged vs clean, "
     "write flagged.csv"),
    ("submit_remediation.py",
     "Step 2 \u2014 submit flagged numbers for remediation (202 Accepted), "
     "store request id"),
    ("webhook_receiver.py",
     "Step 3a \u2014 Flask receiver for the tiered remediation webhooks"),
    ("poll_remediation.py",
     "Step 3b \u2014 poll the remediation request as the no-webhook fallback"),
    ("report.py",
     "Step 4 \u2014 render the five outcome buckets into remediation_report.md"),
]


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Number Reputation Remediation Desk \u2014 dispatcher only.",
    )
    parser.parse_args()

    print("Number Reputation Remediation Desk")
    print("=" * 60)
    print("This is a thin dispatcher. Each workflow step is its own script:\n")
    for script, desc in WORKFLOW:
        print(f"  python {script}")
        print(f"      {desc}\n")
    print("Run `python <script> --help` for flags on any step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
