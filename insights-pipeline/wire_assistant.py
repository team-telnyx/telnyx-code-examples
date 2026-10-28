"""Step 3 \u2014 attach insight_settings (the group) to the assistant.

If ASSISTANT_ID is unset, creates an assistant with platform-default model
and voice and the demo-scenario system prompt. Then sets insight_settings
so every call conversation is analyzed with the group's templates, and
verifies via GET /v2/ai/assistants/{id} that the group is attached.

Endpoint: POST /v2/ai/assistants  |  POST /v2/ai/assistants/{assistant_id}
Endpoint: GET  /v2/ai/assistants/{assistant_id}
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
GROUP_NAME = "qa-scorecard-v1"

DEMO_SYSTEM_PROMPT = (
    "You are a patient-services agent. The caller is a frustrated patient who "
    "will demand to speak to a human. Before discussing anything, verify the "
    "caller's date of birth. Once verified, state the mandatory callback "
    "disclosure line exactly once: 'This call may be recorded for quality and "
    "training purposes.' Then address the caller's request and, if they insist, "
    "escalate to a human agent."
)


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is required (set it in .env).")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _find_group_id(headers: dict[str, str]) -> str:
    resp = requests.get(f"{API_BASE}/ai/conversations/insight-groups", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    records = body.get("data", body) if isinstance(body, dict) else body
    for record in records:
        if record.get("name") == GROUP_NAME:
            return record["id"]
    sys.exit(f"Group {GROUP_NAME} not found \u2014 run create_group.py first.")


def _create_assistant(headers: dict[str, str]) -> str:
    payload: dict[str, Any] = {"name": "insights-pipeline-demo", "instructions": DEMO_SYSTEM_PROMPT}
    resp = requests.post(f"{API_BASE}/ai/assistants", headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    if not record.get("id"):
        sys.exit("Assistant creation response missing 'id'.")
    print(f"Created assistant id={record['id']}")
    return record["id"]


def _attach_insight_settings(headers: dict[str, str], assistant_id: str, group_id: str) -> None:
    payload = {"insight_settings": {"insight_group_id": group_id}}
    url = f"{API_BASE}/ai/assistants/{assistant_id}"
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()


def _verify(headers: dict[str, str], assistant_id: str, group_id: str) -> None:
    resp = requests.get(f"{API_BASE}/ai/assistants/{assistant_id}", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    settings = record.get("insight_settings") or {}
    attached = settings.get("insight_group_id")
    if attached != group_id:
        sys.exit(f"Verification failed: assistant insight_group_id={attached!r}, expected {group_id!r}")
    print(f"\u2713 assistant {assistant_id} insight_settings.insight_group_id={attached}")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Attach insight_settings to the assistant.")
    parser.parse_args()

    headers = _headers()
    group_id = _find_group_id(headers)
    print(f"Using insight group {GROUP_NAME} id={group_id}")

    assistant_id = os.getenv("ASSISTANT_ID") or _create_assistant(headers)
    _attach_insight_settings(headers, assistant_id, group_id)
    _verify(headers, assistant_id, group_id)
    print(f"\nSet ASSISTANT_ID={assistant_id} in .env for place_call.py.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
