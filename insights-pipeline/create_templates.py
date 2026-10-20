"""Step 1 \u2014 create the three structured insight templates.

Each template declares a strict json_schema (object form) so the model's
output is a typed record, not prose. Templates are idempotently named
(sentiment-v1, compliance-v1, escalation-v1): re-runs update instead of
duplicating, and the script diffs template counts before/after and prints
any drift.

Endpoint: POST /ai/conversations/insights  (InsightTemplateCreateReq)
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

SENTIMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "positivity_score": {"type": "number", "minimum": 1, "maximum": 5},
        "frustration_level": {"type": "number", "minimum": 0, "maximum": 5},
        "overall_sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "mixed", "neutral"],
        },
        "key_emotions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["positivity_score", "frustration_level", "overall_sentiment", "key_emotions"],
    "additionalProperties": False,
}

COMPLIANCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verified_identity": {"type": "boolean"},
        "compliance_flags": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": [
                    "identity_verification_passed",
                    "disclosure_missing",
                    "profanity_detected",
                    "sensitive_data_mentioned",
                    "escalation_requested",
                ],
            },
        },
    },
    "required": ["verified_identity", "compliance_flags"],
    "additionalProperties": False,
}

ESCALATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "escalation_reason": {
            "type": "string",
            "enum": [
                "caller_request",
                "compliance_violation",
                "poor_call_quality",
                "system_error",
                "other",
            ],
        },
        "agent_performed_well": {"type": "boolean"},
    },
    "required": ["escalation_reason", "agent_performed_well"],
    "additionalProperties": False,
}

TEMPLATES = [
    {
        "name": "sentiment-v1",
        "instructions": (
            "Score the caller's sentiment across the whole conversation. "
            "positivity_score is 1 (very negative) to 5 (very positive). "
            "frustration_level is 0 (calm) to 5 (irate). key_emotions are free "
            "strings such as frustrated, confused, satisfied."
        ),
        "json_schema": SENTIMENT_SCHEMA,
    },
    {
        "name": "compliance-v1",
        "instructions": (
            "Audit the conversation for compliance. verified_identity is true "
            "only if the agent verified the caller's date of birth before "
            "discussing account details. compliance_flags lists every issue "
            "observed from the allowed enum."
        ),
        "json_schema": COMPLIANCE_SCHEMA,
    },
    {
        "name": "escalation-v1",
        "instructions": (
            "Determine whether the caller escalated and why. escalation_reason "
            "must be one of the allowed enum values. agent_performed_well is "
            "true if the agent handled the escalation professionally."
        ),
        "json_schema": ESCALATION_SCHEMA,
    },
]


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is required (set it in .env).")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _list_templates(headers: dict[str, str]) -> list[dict[str, Any]]:
    resp = requests.get(f"{API_BASE}/ai/conversations/insights", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body) if isinstance(body, dict) else body


def _create_template(headers: dict[str, str], tpl: dict[str, Any], webhook: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": tpl["name"],
        "instructions": tpl["instructions"],
        "json_schema": json.dumps(tpl["json_schema"]),
    }
    if webhook:
        payload["webhook"] = webhook
    resp = requests.post(
        f"{API_BASE}/ai/conversations/insights", headers=headers, json=payload, timeout=30
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body)


def _validate_response(record: dict[str, Any], name: str) -> None:
    if not record.get("id"):
        sys.exit(f"Template {name}: response missing 'id' \u2014 creation failed.")
    if record.get("name") != name:
        sys.exit(f"Template {name}: response name mismatch ({record.get('name')!r}).")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Create the three structured insight templates.")
    parser.parse_args()

    headers = _headers()
    webhook = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    webhook_url = f"{webhook.rstrip('/')}/webhooks/telnyx" if webhook else None

    before = _list_templates(headers)
    print(f"Templates before: {len(before)}")

    created: list[dict[str, Any]] = []
    for tpl in TEMPLATES:
        record = _create_template(headers, tpl, webhook_url)
        _validate_response(record, tpl["name"])
        created.append(record)
        print(f"  \u2713 {record['name']:<16} id={record['id']}")

    after = _list_templates(headers)
    print(f"Templates after:  {len(after)}")
    drift = len(after) - len(before)
    if drift not in (0, len(TEMPLATES)):
        print(f"  \u26a0 drift: expected 0 (update) or {len(TEMPLATES)} (create), saw {drift}")
    else:
        print(f"  \u2713 no unexpected drift (delta={drift})")

    print("\nTemplate IDs:")
    for record in created:
        print(f"  {record['name']}: {record['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
