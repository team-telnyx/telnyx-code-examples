#!/usr/bin/env python3
"""Create a Telnyx AI Assistant with a warm-transfer tool."""

import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv

load_dotenv()

TELNYX_API_BASE = "https://api.telnyx.com/v2"

BILLING_AGENT_PROMPT = """
You are a billing support AI Assistant for Cedar Harbor Bank.

Help callers with billing questions. If the caller has a duplicate charge,
invoice dispute, payment issue, or asks for a person, summarize the issue and
use the transfer tool to connect them to the billing specialist.

Before transferring, briefly tell the caller that you are connecting them to a
specialist who will already have the billing context.
""".strip()

WARM_TRANSFER_INSTRUCTIONS = """
Briefly summarize the caller's billing issue for the specialist. Include what
the caller already said, then ask whether the specialist can take the call.
Only complete the transfer if the specialist accepts.
""".strip()


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def build_assistant_payload() -> dict:
    specialist_number = required_env("BILLING_SPECIALIST_NUMBER")
    from_number = required_env("TELNYX_PHONE_NUMBER")

    return {
        "name": os.getenv("ASSISTANT_NAME", "Billing Warm Transfer Assistant"),
        "model": os.getenv("TELNYX_AI_MODEL", "moonshotai/Kimi-K2.5"),
        "instructions": BILLING_AGENT_PROMPT,
        "tools": [
            {
                "type": "transfer",
                "transfer": {
                    "from": from_number,
                    "targets": [
                        {
                            "name": "Billing Specialist",
                            "to": specialist_number,
                        }
                    ],
                    "warm_transfer_instructions": WARM_TRANSFER_INSTRUCTIONS,
                    "warm_transfer_acceptance": {
                        "enabled": True,
                        "end_user_target_context_mode": "private",
                    },
                },
            }
        ],
    }


def telnyx_post(path: str, payload: dict) -> dict:
    api_key = required_env("TELNYX_API_KEY")
    request = urllib.request.Request(
        f"{TELNYX_API_BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telnyx API error {error.code}: {detail}") from error


def main() -> None:
    payload = build_assistant_payload()
    response = telnyx_post("/ai/assistants", payload)
    print(json.dumps(response, indent=2))


if __name__ == "__main__":
    main()
