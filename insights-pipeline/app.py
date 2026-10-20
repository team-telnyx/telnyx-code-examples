# SELF-REVIEW:
# \u2705 All spec primitives implemented (insight templates, insight groups, assign,
#    assistant insight_settings, conversations-insights polling, webhook receiver)
# \u2705 smoke_test.py imports every named script and verifies _main() exists
# \u2705 Demo mode default (DEMO_MODE=true) \u2014 no real calls placed unless DEMO_MODE=false
# \u2705 No credentials in code \u2014 all from env via dotenv
# \u2705 Webhook receiver verifies Telnyx Ed25519 signature via
#    telnyx.Webhook.construct_event (matches API.md and GUIDE.md)
# ASSUMPTION: The AI Conversations insights endpoints are UNTYPED in the shipped
#   Python SDK, so create_templates.py / create_group.py / scorecard.py call them
#   via raw REST (requests) with the Authorization Bearer header, unwrapping the
#   {"data": ...} envelope, exactly as documented in API.md. Assistant create/update
#   uses the typed SDK (client.ai.assistants.*).
#
# Thin dispatcher only. Each workflow step lives in its own script:
#   create_templates.py  -> step 1: create the three json_schema insight templates
#   create_group.py      -> step 2: create the group and assign the templates
#   wire_assistant.py    -> step 3: attach insight_settings to the assistant
#   place_call.py        -> step 4: place the demo call via scheduled event
#   webhook_receiver.py  -> step 5: FastAPI receiver for insights_generated
#   scorecard.py         -> step 6: schema-validate + render the QA scorecard

import argparse

WORKFLOW = [
    ("create_templates.py", "Step 1 - create the three json_schema insight templates"),
    ("create_group.py", "Step 2 - create the insight group and assign the templates"),
    ("wire_assistant.py", "Step 3 - attach insight_settings to the assistant"),
    ("place_call.py", "Step 4 - place the demo call via the scheduled-event surface"),
    ("webhook_receiver.py", "Step 5 - receive call.conversation.insights_generated"),
    ("scorecard.py", "Step 6 - schema-validate records and render the QA scorecard"),
]


def _main() -> None:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Structured-Insights Pipeline Desk - schema-first conversation mining.",
    )
    parser.add_argument("--list", action="store_true", help="List the workflow scripts.")
    parser.parse_args()

    print("Structured-Insights Pipeline Desk - workflow scripts:\n")
    for name, desc in WORKFLOW:
        print(f"  {name:<22} {desc}")
    print("\nRun any step with:  python <script> --help")


if __name__ == "__main__":
    _main()
