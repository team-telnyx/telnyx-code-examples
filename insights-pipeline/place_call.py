"""Step 4 \u2014 place the demo call and poll insights until completed.

Places the call through the assistant scheduled-event surface (channel
phone_call), writes the returned conversation_id to conversations.json,
then polls GET /ai/conversations/{conversation_id}/conversations-insights
every ~10s (bounded ~3 min) until all records are completed. pending /
in_progress \u2192 keep waiting; failed \u2192 print the record id and exit non-zero.

In demo mode no real call is placed and nothing is written to the store \u2014
the fake conversation id would 404 on the poll path.

Endpoint: POST /v2/ai/assistants/{assistant_id}/scheduled_events
Endpoint: GET  /ai/conversations/{conversation_id}/conversations-insights
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
STORE = Path(__file__).parent / "conversations.json"
POLL_INTERVAL = 10
POLL_TIMEOUT = 180


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is required (set it in .env).")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        sys.exit(
            f"{name} is required. Set it in .env. {name} must be a number already "
            f"associated with the assistant in the Telnyx portal."
        )
    return value


def _existing_ids() -> set[str]:
    if not STORE.exists():
        return set()
    ids: set[str] = set()
    for line in STORE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            ids.add(json.loads(line)["conversation_id"])
        except (json.JSONDecodeError, KeyError):
            continue
    return ids


def _append_store(conversation_id: str) -> bool:
    """Append the conversation_id unless it is already present. Returns True if appended."""
    if conversation_id in _existing_ids():
        return False
    row = {"conversation_id": conversation_id, "received_at": datetime.now(timezone.utc).isoformat()}
    with STORE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    return True


def _place_call(headers: dict[str, str], assistant_id: str, demo: bool) -> str | None:
    destination = _require_env("DESTINATION_NUMBER")
    agent_target = _require_env("ASSISTANT_PHONE_NUMBER")
    scheduled_at = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()

    payload: dict[str, Any] = {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_end_user_target": destination,
        "telnyx_agent_target": agent_target,
        "scheduled_at_fixed_datetime": scheduled_at,
    }

    if demo:
        print("[DEMO MODE] would POST scheduled_events with:")
        print(json.dumps(payload, indent=2))
        return None

    url = f"{API_BASE}/ai/assistants/{assistant_id}/scheduled_events"
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    conversation_id = record.get("conversation_id")
    if not conversation_id:
        sys.exit("Scheduled-event response missing 'conversation_id'.")
    print(f"\u2713 scheduled_event_id={record.get('scheduled_event_id')} conversation_id={conversation_id}")
    return conversation_id


def _fetch_insights(headers: dict[str, str], conversation_id: str) -> list[dict[str, Any]]:
    url = f"{API_BASE}/ai/conversations/{conversation_id}/conversations-insights"
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body) if isinstance(body, dict) else body


def _poll(headers: dict[str, str], conversation_id: str) -> int:
    deadline = time.monotonic() + POLL_TIMEOUT
    while time.monotonic() < deadline:
        records = _fetch_insights(headers, conversation_id)
        statuses = [r.get("status") for r in records]
        print(f"  poll: {len(records)} records, statuses={statuses}")
        if any(s == "failed" for s in statuses):
            for r in records:
                if r.get("status") == "failed":
                    print(f"\u2717 insight {r.get('id')} failed", file=sys.stderr)
            return 1
        if records and all(s == "completed" for s in statuses):
            print("\u2713 all insight records completed")
            return 0
        time.sleep(POLL_INTERVAL)
    print("\u2717 timed out waiting for insights to complete", file=sys.stderr)
    return 1


def _main() -> int:
    parser = argparse.ArgumentParser(description="Place the demo call and poll insights.")
    parser.add_argument(
        "--demo",
        action="store_true",
        default=os.getenv("DEMO_MODE", "true").lower() == "true",
        help="Log the scheduled-event payload instead of placing a real call.",
    )
    args = parser.parse_args()

    headers = _headers()
    assistant_id = os.getenv("ASSISTANT_ID")
    if not assistant_id:
        sys.exit("ASSISTANT_ID is required \u2014 run wire_assistant.py first.")

    conversation_id = _place_call(headers, assistant_id, args.demo)

    if args.demo or conversation_id is None:
        print("[DEMO MODE] no real call placed \u2014 nothing written to conversations.json.")
        return 0

    if _append_store(conversation_id):
        print(f"Appended {conversation_id} to {STORE.name}")
    else:
        print(f"{conversation_id} already in {STORE.name} \u2014 skipped duplicate append.")

    return _poll(headers, conversation_id)


if __name__ == "__main__":
    raise SystemExit(_main())
