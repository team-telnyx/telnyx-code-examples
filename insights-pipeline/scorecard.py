"""Step 6 - schema-validate insight records and render the QA scorecard.

Pulls GET /ai/conversations/{id}/conversations-insights per conversation,
validates every record against the authoritative schemas declared in
create_templates.py (via jsonschema), and aggregates only schema-valid
records. ``--strict`` injects a synthetic invalid record in memory only, so
the failure mode is deterministic and never pollutes the store.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from jsonschema import Draft7Validator

from create_templates import COMPLIANCE_SCHEMA, ESCALATION_SCHEMA, SENTIMENT_SCHEMA

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
STORE = Path(os.getenv("CONVERSATIONS_STORE", "conversations.json"))
SYNTHETIC_ID = "demo-synthetic-invalid"

SCHEMAS: dict[str, dict[str, Any]] = {
    "sentiment-v1": SENTIMENT_SCHEMA,
    "compliance-v1": COMPLIANCE_SCHEMA,
    "escalation-v1": ESCALATION_SCHEMA,
}

# The synthetic record used by --strict: a sentiment record missing the
# required positivity_score field. It is passed through the real validator.
SYNTHETIC_RECORD: dict[str, Any] = {
    "name": "sentiment-v1",
    "status": "completed",
    "result": {"frustration_level": 2, "overall_sentiment": "negative"},
}


def _headers() -> dict[str, str]:
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _load_rows(date_filter: str | None, conversation_id: str | None) -> list[dict[str, Any]]:
    if conversation_id:
        return [{"conversation_id": conversation_id, "received_at": datetime.now(timezone.utc).isoformat()}]
    if not STORE.exists():
        sys.exit(f"No store at {STORE}. Run place_call.py or webhook_receiver.py first.")
    rows: list[dict[str, Any]] = []
    for line in STORE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            print(f"Skipping malformed store line: {line[:80]!r}", file=sys.stderr)
            continue
        if date_filter and not str(row.get("received_at", "")).startswith(date_filter):
            continue
        rows.append(row)
    return rows


def _fetch_records(headers: dict[str, str], conversation_id: str) -> list[dict[str, Any]]:
    try:
        resp = requests.get(
            f"{API_BASE}/ai/conversations/{conversation_id}/conversations-insights",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        print(
            f"Skipping conversation {conversation_id}: HTTP {status}",
            file=sys.stderr,
        )
        return []
    except requests.RequestException as exc:
        print(
            f"Skipping conversation {conversation_id}: {exc}",
            file=sys.stderr,
        )
        return []
    body = resp.json()
    return body.get("data", body) if isinstance(body, dict) else body


def _validate(record: dict[str, Any]) -> list[str]:
    """Return a list of schema violations; empty means the record is valid."""
    name = record.get("name") or record.get("insight_name") or ""
    schema = SCHEMAS.get(name)
    if schema is None:
        return []
    payload = record.get("result") or record.get("insights") or {}
    validator = Draft7Validator(schema)
    return [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
    ]


def _render(valid: list[dict[str, Any]], invalid: list[tuple[str, list[str]]], pending: int) -> None:
    sentiments = Counter()
    flags = Counter()
    escalations = Counter()
    total_conversations = len({r.get("_conversation_id") for r in valid if r.get("_conversation_id")})
    for record in valid:
        name = record.get("name") or record.get("insight_name") or ""
        payload = record.get("result") or record.get("insights") or {}
        if name == "sentiment-v1" and "overall_sentiment" in payload:
            sentiments[payload["overall_sentiment"]] += 1
        if name == "compliance-v1":
            for flag in payload.get("compliance_flags", []):
                flags[flag] += 1
        if name == "escalation-v1" and "escalation_reason" in payload:
            escalations[payload["escalation_reason"]] += 1

    print("\n=== QA SCORECARD ===")
    print(f"valid records: {len(valid)}  invalid: {len(invalid)}  pending: {pending}")
    print(f"valid conversations: {total_conversations}")
    print("\nSentiment distribution:")
    for key, count in sentiments.most_common():
        print(f"  {key:<10} {count}")
    print("\nCompliance-flag rates (flags / valid conversations):")
    for key, count in flags.most_common():
        rate = count / total_conversations if total_conversations else 0.0
        print(f"  {key:<30} {count} ({rate:.0%})")
    print("\nEscalation breakdown:")
    for key, count in escalations.most_common():
        print(f"  {key:<20} {count}")
    if invalid:
        print("\nSchema-invalid records (excluded from aggregates):")
        for conversation_id, errors in invalid:
            print(f"  {conversation_id}: {'; '.join(errors)}")


def _main() -> None:
    parser = argparse.ArgumentParser(description="Render the QA scorecard.")
    parser.add_argument("--date", help="Filter store rows by ISO date prefix.")
    parser.add_argument("--conversation-id", help="Override the store for a manual run.")
    parser.add_argument("--strict", action="store_true", help="Inject a synthetic invalid record.")
    args = parser.parse_args()

    headers = _headers()
    rows = _load_rows(args.date, args.conversation_id)

    valid: list[dict[str, Any]] = []
    invalid: list[tuple[str, list[str]]] = []
    pending = 0

    if args.strict:
        # Run the synthetic record through the real validator so the violation
        # is produced by Draft7Validator, not hardcoded.
        errors = _validate(SYNTHETIC_RECORD)
        if errors:
            invalid.append((SYNTHETIC_ID, errors))
            print(
                f"Injected synthetic invalid record for conversation {SYNTHETIC_ID} "
                "(in memory only)"
            )

    for row in rows:
        conversation_id = row["conversation_id"]
        for record in _fetch_records(headers, conversation_id):
            status = record.get("status")
            if status in {"pending", "in_progress"}:
                pending += 1
                continue
            errors = _validate(record)
            if errors:
                invalid.append((conversation_id, errors))
            else:
                record["_conversation_id"] = conversation_id
                valid.append(record)

    _render(valid, invalid, pending)


if __name__ == "__main__":
    _main()
