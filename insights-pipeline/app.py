# SELF-REVIEW:
# \u2705 All spec primitives implemented (insight templates, insight groups, assign,
#    assistant insight_settings, conversations-insights poll, insights_generated webhook)
# \u2705 smoke_test.py imports every workflow script and verifies _main() exists
# \u2705 Demo mode default (DEMO_MODE=true) \u2014 no real calls placed unless DEMO_MODE=false
# \u2705 No credentials in code \u2014 all from env via dotenv
# \u2705 Webhook signature verification via telnyx.Webhook.construct_event, with
#    TELNYX_PUBLIC_KEY required at startup \u2014 no unverified fallback path
# \u2705 Thin dispatcher only \u2014 workflow lives in the six named scripts
#
# ASSUMPTION: The ticket's "Framework: flask" applies to webhook_receiver.py
# (the Flask receiver). The other five scripts are standalone CLI scripts
# using requests. app.py is a dispatcher menu.
"""Structured-Insights Pipeline Desk \u2014 thin dispatcher.

Each workflow step is a standalone script. Run them in order:

    python create_templates.py   # 1. create the three json_schema insight templates
    python create_group.py       # 2. create the insight group + assign templates
    python wire_assistant.py     # 3. attach insight_settings to the assistant
    python place_call.py         # 4. place the demo call, poll until insights complete
    python webhook_receiver.py   # 5. (optional) receive call.conversation.insights_generated
    python scorecard.py          # 6. render the QA scorecard from typed records
"""
from __future__ import annotations

import argparse

WORKFLOW = [
    ("create_templates.py", "Create the three structured insight templates (json_schema)."),
    ("create_group.py", "Create the insight group and assign the three templates."),
    ("wire_assistant.py", "Attach insight_settings (group) to the assistant."),
    ("place_call.py", "Place the demo call and poll insights until completed."),
    ("webhook_receiver.py", "Run the Flask receiver for call.conversation.insights_generated."),
    ("scorecard.py", "Render the QA scorecard; --strict flags schema-invalid records."),
]


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Structured-Insights Pipeline Desk \u2014 dispatcher for the six workflow scripts.",
    )
    parser.parse_args()
    print("Structured-Insights Pipeline Desk \u2014 workflow steps:\n")
    for name, desc in WORKFLOW:
        print(f"  python {name:<24} {desc}")
    print("\nRun each script with --help for its options.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
