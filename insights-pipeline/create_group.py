"""Step 2 \u2014 create the insight group and assign the three templates.

Endpoint: POST /ai/conversations/insight-groups
Endpoint: POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign

Assignment is verified by re-reading the group and printing its membership.
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
TEMPLATE_NAMES = ["sentiment-v1", "compliance-v1", "escalation-v1"]


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is required (set it in .env).")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _find_templates(headers: dict[str, str]) -> dict[str, str]:
    resp = requests.get(f"{API_BASE}/ai/conversations/insights", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    records = body.get("data", body) if isinstance(body, dict) else body
    by_name = {r["name"]: r["id"] for r in records if r.get("name") in TEMPLATE_NAMES}
    missing = [n for n in TEMPLATE_NAMES if n not in by_name]
    if missing:
        sys.exit(f"Missing templates {missing} \u2014 run create_templates.py first.")
    return by_name


def _find_or_create_group(headers: dict[str, str], webhook_url: str | None) -> str:
    resp = requests.get(f"{API_BASE}/ai/conversations/insight-groups", headers=headers, timeout=30)
    if resp.status_code == 200:
        body = resp.json()
        records = body.get("data", body) if isinstance(body, dict) else body
        for record in records:
            if record.get("name") == GROUP_NAME:
                print(f"Reusing existing group {GROUP_NAME} id={record['id']}")
                return record["id"]

    payload: dict[str, Any] = {
        "name": GROUP_NAME,
        "description": "QA scorecard bundle: sentiment + compliance + escalation.",
    }
    if webhook_url:
        payload["webhook"] = webhook_url
    resp = requests.post(
        f"{API_BASE}/ai/conversations/insight-groups", headers=headers, json=payload, timeout=30
    )
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    if not record.get("id"):
        sys.exit("Group creation response missing 'id'.")
    print(f"Created group {GROUP_NAME} id={record['id']}")
    return record["id"]


def _assign(headers: dict[str, str], group_id: str, insight_id: str) -> None:
    url = f"{API_BASE}/ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign"
    resp = requests.post(url, headers=headers, timeout=30)
    resp.raise_for_status()


def _read_membership(headers: dict[str, str], group_id: str) -> list[dict[str, Any]]:
    url = f"{API_BASE}/ai/conversations/insight-groups/{group_id}"
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    record = body.get("data", body)
    return record.get("insights", record.get("insight_templates", []))


def _main() -> int:
    parser = argparse.ArgumentParser(description="Create the insight group and assign templates.")
    parser.parse_args()

    headers = _headers()
    webhook = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    webhook_url = f"{webhook.rstrip('/')}/webhooks/telnyx" if webhook else None

    templates = _find_templates(headers)
    group_id = _find_or_create_group(headers, webhook_url)

    for name in TEMPLATE_NAMES:
        _assign(headers, group_id, templates[name])
        print(f"  \u2713 assigned {name} ({templates[name]})")

    membership = _read_membership(headers, group_id)
    print(f"\nGroup {group_id} membership ({len(membership)}):")
    for item in membership:
        print(f"  - {item.get('name', item.get('id'))} id={item.get('id')}")

    assigned_names = {item.get("name") for item in membership}
    missing = [n for n in TEMPLATE_NAMES if n not in assigned_names]
    if missing:
        sys.exit(f"Assignment verification failed \u2014 missing {missing}")
    print("\n\u2713 all three templates verified in group membership")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
