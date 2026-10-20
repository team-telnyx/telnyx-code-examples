"""Step 1 - create the three structured insight templates.

Each template declares a strict ``json_schema`` (object form) so the model's
output is a typed record, not prose. Templates are idempotently named
(``sentiment-v1`` etc.) so re-runs update instead of duplicate.

The AI Conversations insights endpoints are untyped in the shipped Python SDK,
so we call them via raw REST and unwrap the ``{"data": ...}`` envelope.
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
        "frustration_level": {"type": "number", "minimum": 1, "maximum": 5},
        "overall_sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "mixed", "neutral"],
        },
        "key_emotions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["positivity_score", "frustration_level", "overall_sentiment"],
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
}

TEMPLATES = [
    {
        "name": "sentiment-v1",
        "instructions": (
            "Score the caller's sentiment across the whole conversation. "
            "positivity_score is 1 (very negative) to 5 (very positive). "
            "frustration_level is 1 (calm) to 5 (irate). overall_sentiment must "
            "be one of the declared enum values. key_emotions is a free list, "
            "e.g. frustrated, confused, satisfied."
        ),
        "json_schema": SENTIMENT_SCHEMA,
    },
    {
        "name": "compliance-v1",
        "instructions": (
            "Audit the conversation for compliance. verified_identity is true "
            "only if the agent verified the caller's date of birth before "
            "discussing account details. compliance_flags lists every issue "
            "observed; use identity_verification_passed when verification "
            "succeeded and disclosure_missing when the mandatory callback "
            "disclosure line was never stated."
        ),
        "json_schema": COMPLIANCE_SCHEMA,
    },
    {
        "name": "escalation-v1",
        "instructions": (
            "Determine why the conversation escalated, if it did. "
            "escalation_reason must be one of the declared enum values; use "
            "caller_request when the caller demanded a human. "
            "agent_performed_well is true when the agent handled the call well."
        ),
        "json_schema": ESCALATION_SCHEMA,
    },
]


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _list_templates(headers: dict[str, str]) -> list[dict[str, Any]]:
    resp = requests.get(f"{API_BASE}/ai/conversations/insights", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body) if isinstance(body, dict) else body


def _create_template(headers: dict[str, str], template: dict[str, Any]) -> dict[str, Any]:
    payload = dict(template)
    webhook = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    if webhook:
        payload["webhook"] = f"{webhook.rstrip('/')}/webhooks/telnyx"
    resp = requests.post(
        f"{API_BASE}/ai/conversations/insights",
        headers=headers,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body)


def _validate_response(record: dict[str, Any], name: str) -> None:
    if not record.get("id"):
        sys.exit(f"Template '{name}' creation response is missing an id: {record}")
    schema = record.get("json_schema")
    if schema is None:
        sys.exit(f"Template '{name}' response did not echo a json_schema: {record}")


def _ids_by_name(templates: list[dict[str, Any]]) -> dict[str, str]:
    return {t["name"]: t["id"] for t in templates if t.get("name") and t.get("id")}


def _main() -> None:
    parser = argparse.ArgumentParser(description="Create the three insight templates.")
    parser.parse_args()

    headers = _headers()
    before = _ids_by_name(_list_templates(headers))
    print(f"Existing insight templates before run: {len(before)}")

    created: list[dict[str, Any]] = []
    for template in TEMPLATES:
        record = _create_template(headers, template)
        _validate_response(record, template["name"])
        created.append(record)
        print(f"  {template['name']:<16} id={record['id']}")

    after = _ids_by_name(_list_templates(headers))
    print(f"Existing insight templates after run: {len(after)}")

    # Idempotent naming: the same name must reuse the same id (update semantics).
    for template in TEMPLATES:
        name = template["name"]
        if name in before and after.get(name) != before[name]:
            sys.exit(
                f"Drift detected: template '{name}' changed id "
                f"({before[name]} -> {after.get(name)}). Expected update-in-place."
            )
    new_names = set(after) - set(before)
    unexpected = new_names - {t["name"] for t in TEMPLATES}
    if unexpected:
        sys.exit(f"Drift detected: unexpected new templates {sorted(unexpected)}")

    # Count drift: a template deleted between runs must be reported explicitly.
    delta = len(after) - len(before)
    print(f"Template count delta: {delta:+d} (before={len(before)}, after={len(after)})")
    if delta != 0:
        sys.exit(
            f"Drift detected: template count changed by {delta:+d}. "
            "Expected zero net change on an idempotent re-run."
        )
    print("Drift check: all templates updated in place (no duplicates, no count drift).")

    print("\nTemplate IDs (export these for create_group.py):")
    print(json.dumps({t["name"]: t["id"] for t in created}, indent=2))


if __name__ == "__main__":
    _main()
