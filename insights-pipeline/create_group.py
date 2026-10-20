"""Step 2 - create the insight group and assign the three templates.

Bundling templates into a group is the documented composition pattern: the
assistant references the group once, and every call conversation is analyzed
with all templates applied. Membership is verified by re-reading the group and
comparing the returned insight ID set against the assigned template ID set.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
GROUP_NAME = "qa-scorecard-v1"


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _template_ids() -> list[str]:
    raw = os.getenv("INSIGHT_TEMPLATE_IDS", "")
    ids = [item.strip() for item in raw.split(",") if item.strip()]
    if not ids:
        sys.exit(
            "INSIGHT_TEMPLATE_IDS is not set. Run create_templates.py and put the "
            "three template IDs (comma-separated) into .env."
        )
    return ids


def _create_group(headers: dict[str, str]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": GROUP_NAME,
        "description": "QA scorecard: sentiment, compliance, escalation.",
    }
    webhook = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    if webhook:
        payload["webhook"] = f"{webhook.rstrip('/')}/webhooks/telnyx"
    resp = requests.post(
        f"{API_BASE}/ai/conversations/insight-groups",
        headers=headers,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body)


def _assign(headers: dict[str, str], group_id: str, insight_id: str) -> None:
    resp = requests.post(
        f"{API_BASE}/ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign",
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()


def _read_group(headers: dict[str, str], group_id: str) -> dict[str, Any]:
    resp = requests.get(
        f"{API_BASE}/ai/conversations/insight-groups/{group_id}",
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body)


def _member_ids(group: dict[str, Any]) -> set[str]:
    members = group.get("insights") or group.get("insight_ids") or []
    ids: set[str] = set()
    for member in members:
        if isinstance(member, dict):
            member_id = member.get("id") or member.get("insight_id")
        else:
            member_id = member
        if member_id:
            ids.add(str(member_id))
    return ids


def _main() -> None:
    parser = argparse.ArgumentParser(description="Create the insight group and assign templates.")
    parser.parse_args()

    headers = _headers()
    template_ids = _template_ids()

    group = _create_group(headers)
    group_id = group.get("id")
    if not group_id:
        sys.exit(f"Group creation response is missing an id: {group}")
    print(f"Created insight group '{GROUP_NAME}' id={group_id}")

    for insight_id in template_ids:
        _assign(headers, group_id, insight_id)
        print(f"  assigned insight {insight_id}")

    verified = _read_group(headers, group_id)
    members = verified.get("insights") or verified.get("insight_ids") or []
    print(f"\nVerified membership ({len(members)} templates):")
    print(json.dumps(members, indent=2))

    expected = set(template_ids)
    actual = _member_ids(verified)
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        sys.exit(
            "Membership mismatch - group does not contain exactly the assigned "
            f"templates. missing={sorted(missing)} extra={sorted(extra)}"
        )

    print(f"\nExport for wire_assistant.py:\nINSIGHT_GROUP_ID={group_id}")


if __name__ == "__main__":
    _main()
