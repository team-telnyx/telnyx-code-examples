"""Step 6 \u2014 render the QA scorecard from typed insight records.

Reads conversation IDs from conversations.json (filtered by --date or
overridden by --conversation-id), fetches
GET /ai/conversations/{conversation_id}/conversations-insights, flattens
the nested conversation_insights entries (per-template results arrive as
JSON strings keyed by insight_id — the template uuid), validates every
entry against the declared json_schemas, and aggregates into the
scorecard. --strict injects a synthetic invalid record (missing
positivity_score) under conversation id 'demo-synthetic-invalid', flags
it, excludes it from aggregates, and prints its conversation id. If the
validator fails to flag the synthetic record the script exits non-zero.

SCHEMAS mirrors the json_schemas declared in create_templates.py (single
source of truth: the schema dicts are imported from create_templates).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from create_templates import COMPLIANCE_SCHEMA, ESCALATION_SCHEMA, SENTIMENT_SCHEMA

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
STORE = Path(__file__).parent / "conversations.json"
SYNTHETIC_ID = "demo-synthetic-invalid"


def _schema_view(schema: dict[str, Any]) -> dict[str, Any]:
    """Reduce a JSON Schema to the {required, enums} view the validator uses."""
    enums: dict[str, list[Any]] = {}
    for field, spec in schema.get("properties", {}).items():
        if "enum" in spec:
            enums[field] = list(spec["enum"])
        elif spec.get("type") == "array" and "enum" in spec.get("items", {}):
            enums[field] = list(spec["items"]["enum"])
    return {"required": list(schema.get("required", [])), "enums": enums}


SCHEMAS: dict[str, dict[str, Any]] = {
    "sentiment-v1": _schema_view(SENTIMENT_SCHEMA),
    "compliance-v1": _schema_view(COMPLIANCE_SCHEMA),
    "escalation-v1": _schema_view(ESCALATION_SCHEMA),
}


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is required (set it in .env).")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _load_store(date_filter: str | None) -> list[str]:
    if not STORE.exists():
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for line in STORE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        cid = row.get("conversation_id")
        if not cid or cid in seen:
            continue
        if cid.startswith("demo-"):
            continue
        if date_filter and not row.get("received_at", "").startswith(date_filter):
            continue
        seen.add(cid)
        ids.append(cid)
    return ids


def _template_name_map(headers: dict[str, str]) -> dict[str, str]:
    """Map template id -> template name so insight records can be schema-matched."""
    resp = requests.get(f"{API_BASE}/ai/conversations/insights", headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    records = body.get("data", body) if isinstance(body, dict) else body
    return {r["id"]: r.get("name") for r in records if r.get("id")}


def _fetch(headers: dict[str, str], conversation_id: str) -> list[dict[str, Any]]:
    url = f"{API_BASE}/ai/conversations/{conversation_id}/conversations-insights"
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", body) if isinstance(body, dict) else body


def _validate(name: str | None, result: dict[str, Any]) -> list[str]:
    schema = SCHEMAS.get(name) if name else None
    if not schema:
        return []
    errors: list[str] = []
    for field in schema["required"]:
        if field not in result:
            errors.append(f"missing required field '{field}'")
    for field, allowed in schema["enums"].items():
        value = result.get(field)
        if value is None:
            continue
        values = value if isinstance(value, list) else [value]
        for v in values:
            if v not in allowed:
                errors.append(f"'{field}' value {v!r} not in enum")
    return errors


def _render(valid: list[dict[str, Any]], invalid: list[tuple[str, list[str]]], pending: int) -> None:
    sentiments = Counter()
    flags = Counter()
    escalations = Counter()
    for record in valid:
        result = record.get("result") or {}
        if result.get("overall_sentiment"):
            sentiments[result["overall_sentiment"]] += 1
        for flag in result.get("compliance_flags", []):
            flags[flag] += 1
        if result.get("escalation_reason"):
            escalations[result["escalation_reason"]] += 1

    print("\n=== QA SCORECARD ===")
    print(f"valid records:   {len(valid)}")
    print(f"invalid records: {len(invalid)}")
    print(f"pending records: {pending}")
    print("\nSentiment distribution:")
    for k, v in sentiments.most_common():
        print(f"  {k:<10} {v}")
    print("\nCompliance-flag rates:")
    for k, v in flags.most_common():
        print(f"  {k:<32} {v}")
    print("\nEscalation breakdown:")
    for k, v in escalations.most_common():
        print(f"  {k:<20} {v}")
    if invalid:
        print("\nSchema-invalid records (excluded from aggregates):")
        for cid, errors in invalid:
            print(f"  {cid}: {'; '.join(errors)}")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Render the QA scorecard.")
    parser.add_argument("--date", help="ISO date prefix filter on received_at (e.g. 2026-10-20)")
    parser.add_argument("--conversation-id", help="Override the store for a manual run")
    parser.add_argument("--strict", action="store_true", help="Inject and flag a synthetic invalid record")
    args = parser.parse_args()

    headers = _headers()
    conversation_ids = [args.conversation_id] if args.conversation_id else _load_store(args.date)
    names_by_id = _template_name_map(headers)

    valid: list[dict[str, Any]] = []
    invalid: list[tuple[str, list[str]]] = []
    pending = 0

    for cid in conversation_ids:
        for group_record in _fetch(headers, cid):
            status = group_record.get("status")
            if status in ("pending", "in_progress"):
                pending += 1
                continue
            for entry in group_record.get("conversation_insights") or []:
                name = names_by_id.get(entry.get("insight_id"))
                raw = entry.get("result")
                try:
                    result = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except json.JSONDecodeError as exc:
                    label = name or entry.get("insight_id") or "unknown-template"
                    invalid.append((cid, [f"unparseable result for {label}: {exc}"]))
                    continue
                if not isinstance(result, dict):
                    result = {}
                errors = _validate(name, result)
                if errors:
                    invalid.append((cid, errors))
                else:
                    valid.append({"name": name, "result": result})

    if args.strict:
        synthetic = {
            "name": "sentiment-v1",
            "result": {"frustration_level": 3, "overall_sentiment": "negative", "key_emotions": ["frustrated"]},
        }
        errors = _validate(synthetic["name"], synthetic["result"])
        if not errors:
            print(
                f"\u2717 [--strict] validator failed to flag the synthetic invalid record under {SYNTHETIC_ID}",
                file=sys.stderr,
            )
            return 1
        invalid.append((SYNTHETIC_ID, errors))
        print(f"[--strict] injected synthetic invalid record under {SYNTHETIC_ID}")

    _render(valid, invalid, pending)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
