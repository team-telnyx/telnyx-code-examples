"""Step 3 - attach insight_settings to the assistant.

The assistant's ``insight_settings`` references the group, so every call
conversation is analyzed once with all templates applied - no per-call wiring.
The assistant is created here unless ASSISTANT_ID is provided in the env.
"""

from __future__ import annotations

import argparse
import os
import sys

import telnyx
from dotenv import load_dotenv

load_dotenv()

DEMO_SYSTEM_PROMPT = (
    "You are a patient-support agent for a clinic. The caller is frustrated and "
    "demands to speak to a human. Before discussing anything, verify the caller's "
    "date of birth. State the mandatory callback-disclosure line exactly once: "
    "'This call may be recorded and a callback may be scheduled.' If the caller "
    "asks for a human, acknowledge and escalate."
)


def _client() -> telnyx.Client:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return telnyx.Client(api_key=api_key)


def _group_id() -> str:
    group_id = os.getenv("INSIGHT_GROUP_ID")
    if not group_id:
        sys.exit("INSIGHT_GROUP_ID is not set. Run create_group.py and export its output.")
    return group_id


def _insight_settings(group_id: str) -> dict[str, object]:
    return {"insight_group_id": group_id, "enabled": True}


def _main() -> None:
    parser = argparse.ArgumentParser(description="Attach insight_settings to the assistant.")
    parser.parse_args()

    client = _client()
    group_id = _group_id()
    assistant_id = os.getenv("ASSISTANT_ID")

    if assistant_id:
        client.ai.assistants.update(
            assistant_id,
            insight_settings=_insight_settings(group_id),
        )
        print(f"Updated assistant {assistant_id} with insight group {group_id}")
    else:
        assistant = client.ai.assistants.create(
            name="Structured-Insights Demo Assistant",
            instructions=DEMO_SYSTEM_PROMPT,
            insight_settings=_insight_settings(group_id),
        )
        assistant_id = assistant.id
        print(f"Created assistant {assistant_id} with insight group {group_id}")

    verified = client.ai.assistants.retrieve(assistant_id)
    settings = getattr(verified, "insight_settings", None)
    print(f"Verified insight_settings on assistant: {settings}")
    if not settings:
        sys.exit("Assistant does not report insight_settings - wiring failed.")

    print(f"\nExport for place_call.py:\nASSISTANT_ID={assistant_id}")


if __name__ == "__main__":
    _main()
