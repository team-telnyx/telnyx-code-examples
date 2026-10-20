"""Step 4 - place the demo call through the assistant scheduled-event surface.

Sends channel ``phone_call`` with the end-user target and the assistant's
phone number, scheduled ~60 seconds out. The create response includes the
``conversation_id``, which we append to the local JSON-lines store so
scorecard.py can find it without enumerating the account.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
STORE = Path(os.getenv("CONVERSATIONS_STORE", "conversations.json"))
E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _require_e164(value: str, var_name: str) -> str:
    if not E164_RE.match(value):
        sys.exit(
            f"{var_name}={value!r} is not valid E.164. Use a number like "
            "'+15550000000' (leading '+', country code, digits only)."
        )
    return value


def _store_ids() -> set[str]:
    if not STORE.exists():
        return set()
    ids: set[str] = set()
    for line in STORE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ids.add(json.loads(line)["conversation_id"])
        except (json.JSONDecodeError, KeyError):
            continue
    return ids


def _append_row(conversation_id: str) -> None:
    if not isinstance(conversation_id, str) or not conversation_id.strip():
        sys.exit(f"Refusing to store an invalid conversation_id: {conversation_id!r}")
    if conversation_id in _store_ids():
        print(f"conversation_id={conversation_id} already in {STORE}; skipping append.")
        return
    row = {
        "conversation_id": conversation_id,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    with STORE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")


def _main() -> None:
    parser = argparse.ArgumentParser(description="Place the demo call via scheduled event.")
    parser.add_argument("--dry-run", action="store_true", help="Print the payload only.")
    args = parser.parse_args()

    assistant_id = os.getenv("ASSISTANT_ID")
    if not assistant_id:
        sys.exit("ASSISTANT_ID is not set. Run wire_assistant.py and export its output.")

    destination = os.getenv("DESTINATION_NUMBER")
    agent_number = os.getenv("ASSISTANT_PHONE_NUMBER")
    if not destination:
        sys.exit("DESTINATION_NUMBER is not set (the caller's number, E.164).")
    if not agent_number:
        sys.exit(
            "ASSISTANT_PHONE_NUMBER is not set. telnyx_agent_target must be a number "
            "already associated with the assistant in the portal."
        )
    _require_e164(destination, "DESTINATION_NUMBER")
    _require_e164(agent_number, "ASSISTANT_PHONE_NUMBER")

    scheduled_at = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
    payload = {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_end_user_target": destination,
        "telnyx_agent_target": agent_number,
        "scheduled_at_fixed_datetime": scheduled_at,
    }

    if args.dry_run or os.getenv("DEMO_MODE", "true").lower() == "true":
        print("[DEMO MODE] Would POST the scheduled event with payload:")
        print(json.dumps(payload, indent=2))
        print("Set DEMO_MODE=false to place the real call.")
        return

    resp = requests.post(
        f"{API_BASE}/ai/assistants/{assistant_id}/scheduled-events",
        headers=_headers(),
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    conversation_id = record.get("conversation_id")
    if not conversation_id:
        sys.exit(f"Scheduled-event response is missing conversation_id: {record}")

    _append_row(conversation_id)
    print(f"Scheduled call at {scheduled_at} - conversation_id={conversation_id}")
    print(f"Appended row to {STORE}. Run scorecard.py once insights complete.")


if __name__ == "__main__":
    _main()
