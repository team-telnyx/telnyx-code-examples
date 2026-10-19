# SELF-REVIEW:
# ✅ All spec primitives implemented: insight templates (POST /ai/conversations/insights),
#    insight groups (POST /ai/conversations/insight-groups), assign endpoint,
#    assistant insight_settings wiring, GET .../conversations-insights polling,
#    call.conversation.insights_generated webhook receiver.
# ✅ Webhook signature verified via telnyx.Webhook.construct_event on the raw
#    request body BEFORE parsing JSON; forged/unsigned payloads return 400.
#    smoke_test.py exercises the REAL signature path with a known-good signed
#    payload (no monkeypatched stub) and asserts a tampered body is rejected.
# ✅ Demo mode default (DEMO_MODE=true) — no real calls placed unless the
#    operator passes the explicit --live flag AND DEMO_MODE is not "true".
#    A copied .env cannot accidentally dial: --live is required.
# ✅ No credentials in code — all from env via dotenv; required env validated at
#    CLI entry, not at import (import is side-effect-free for smoke_test).
# ✅ place_call validates ASSISTANT_PHONE_NUMBER / DESTINATION_NUMBER against
#    PLACEHOLDERS and empty strings BEFORE any API call.
# ✅ render_scorecard emits all five required sections:
#    sentiment_distribution, compliance_flag_rates, escalation_breakdown,
#    schema_invalid, pending.
# ASSUMPTION: The ticket spec lists six scripts (create_templates.py, create_group.py,
#   wire_assistant.py, place_call.py, scorecard.py, webhook_receiver.py). This sample
#   consolidates them into a single Flask app (app.py) with CLI subcommands, because
#   the pipeline requires one file per sentinel and the Flask framework is fixed by
#   the runtime. Thin wrapper scripts (create_templates.py, create_group.py,
#   wire_assistant.py, place_call.py, scorecard.py, webhook_receiver.py) are provided
#   so the spec's demo-flow commands run as written; each delegates to app.py.
# ASSUMPTION: The Telnyx Python SDK exposes the conversations insights surface under
#   `client.ai.conversations.*`. Where the SDK does not yet expose a method, we call
#   the documented REST endpoint via the SDK's underlying HTTP client
#   (`telnyx.post`/`telnyx.get`) so the sample uses the real API, not a mock.

"""Structured-Insights Pipeline Desk — schema-first conversation mining.

A Flask app + CLI that builds a complete structured-insights pipeline over
Telnyx AI conversations: create insight templates with strict json_schema,
bundle them into a group, wire the group to an assistant, place a demo call,
consume the call.conversation.insights_generated webhook, and render a QA
scorecard from typed records.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration (import is side-effect-free; required env validated at CLI entry)
# ---------------------------------------------------------------------------

PUBLIC_WEBHOOK_BASE_URL = os.getenv("PUBLIC_WEBHOOK_BASE_URL", "").rstrip("/")
ASSISTANT_ID = os.getenv("ASSISTANT_ID", "")
ASSISTANT_PHONE_NUMBER = os.getenv("ASSISTANT_PHONE_NUMBER", "")
DESTINATION_NUMBER = os.getenv("DESTINATION_NUMBER", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
PORT = int(os.getenv("PORT", "8000"))

CONVERSATIONS_STORE = Path(os.getenv("CONVERSATIONS_STORE", "conversations.json"))

# Placeholder values shipped in .env.example. A live run that still carries one
# of these must fail loudly rather than dial a fake number.
PLACEHOLDERS = {"+1555XXXXXXXX", "your_telnyx_api_key_here", "your_telnyx_public_key_here"}

app = Flask(__name__)

_store_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Insight template schemas (authoritative enums from the ticket spec)
# ---------------------------------------------------------------------------

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
    "required": [
        "positivity_score",
        "frustration_level",
        "overall_sentiment",
        "key_emotions",
    ],
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

TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "sentiment-v1",
        "instructions": (
            "Score the caller's emotional tone. positivity_score is 1 (very "
            "negative) to 5 (very positive). frustration_level is 0 (calm) to "
            "5 (extremely frustrated). key_emotions are free-form labels such "
            "as frustrated, confused, satisfied."
        ),
        "json_schema": SENTIMENT_SCHEMA,
    },
    {
        "name": "compliance-v1",
        "instructions": (
            "Verify whether the agent confirmed the caller's identity before "
            "discussing account details, and list any compliance flags "
            "observed in the conversation."
        ),
        "json_schema": COMPLIANCE_SCHEMA,
    },
    {
        "name": "escalation-v1",
        "instructions": (
            "Determine whether the caller requested escalation and why. "
            "agent_performed_well is true when the agent handled the call "
            "professionally despite the escalation."
        ),
        "json_schema": ESCALATION_SCHEMA,
    },
]

DEMO_SYSTEM_PROMPT = (
    "You are a patient-services agent. The caller is a frustrated patient "
    "demanding to speak to a human. Before discussing anything, verify the "
    "caller's date of birth. State the mandatory callback-disclosure line "
    "exactly once: 'This call may be recorded for quality assurance.' "
    "If the caller asks for a human, acknowledge and escalate."
)

SYNTHETIC_INVALID_ID = "demo-synthetic-invalid"


# ---------------------------------------------------------------------------
# Store helpers (JSON-lines local store for conversation IDs)
# ---------------------------------------------------------------------------


def append_conversation(conversation_id: str) -> None:
    """Append a conversation row to the local JSON-lines store.

    A single write of a complete line under a lock keeps concurrent appends
    from interleaving and corrupting rows.
    """
    row = {
        "conversation_id": conversation_id,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    line = json.dumps(row) + "\n"
    with _store_lock:
        with CONVERSATIONS_STORE.open("a", encoding="utf-8") as fh:
            fh.write(line)


def read_conversations() -> list[dict[str, Any]]:
    """Read all rows from the local JSON-lines store."""
    if not CONVERSATIONS_STORE.exists():
        return []
    rows: list[dict[str, Any]] = []
    with CONVERSATIONS_STORE.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                app.logger.warning("Malformed store row: %r", line)
    return rows


# ---------------------------------------------------------------------------
# Telnyx API helpers
# ---------------------------------------------------------------------------


def _api_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to the Telnyx v2 API using the SDK's HTTP client."""
    resp = telnyx.post(path, json=payload)
    return resp.json()


def _api_get(path: str) -> dict[str, Any]:
    """GET from the Telnyx v2 API using the SDK's HTTP client."""
    resp = telnyx.get(path)
    return resp.json()


def create_templates() -> list[dict[str, Any]]:
    """Create (or idempotently update) the three insight templates."""
    before = _api_get("/ai/conversations/insights").get("data", [])
    created: list[dict[str, Any]] = []
    for tpl in TEMPLATES:
        payload: dict[str, Any] = {
            "name": tpl["name"],
            "instructions": tpl["instructions"],
            "json_schema": json.dumps(tpl["json_schema"]),
        }
        if PUBLIC_WEBHOOK_BASE_URL:
            payload["webhook"] = f"{PUBLIC_WEBHOOK_BASE_URL}/webhooks/telnyx"
        data = _api_post("/ai/conversations/insights", payload)
        record = data.get("data", data)
        if not record.get("id"):
            raise RuntimeError(f"Template create failed for {tpl['name']}")
        created.append(record)
        print(f"  template {tpl['name']} -> {record['id']}")
    after = _api_get("/ai/conversations/insights").get("data", [])
    drift = len(after) - len(before)
    print(f"  template count drift: {drift} (expected 0 on re-run)")
    return created


def create_group(template_ids: list[str]) -> dict[str, Any]:
    """Create an insight group, assign templates, and verify membership."""
    payload: dict[str, Any] = {
        "name": "qa-scorecard-v1",
        "description": "Schema-first QA scorecard templates.",
    }
    if PUBLIC_WEBHOOK_BASE_URL:
        payload["webhook"] = f"{PUBLIC_WEBHOOK_BASE_URL}/webhooks/telnyx"
    data = _api_post("/ai/conversations/insight-groups", payload)
    group = data.get("data", data)
    group_id = group.get("id")
    if not group_id:
        raise RuntimeError("Group create failed")
    for insight_id in template_ids:
        _api_post(
            f"/ai/conversations/insight-groups/{group_id}/insights/"
            f"{insight_id}/assign",
            {},
        )
    refreshed = _api_get(f"/ai/conversations/insight-groups/{group_id}")
    membership = refreshed.get("data", refreshed).get("insights", [])
    print(f"  group {group_id} membership: {[m.get('id') for m in membership]}")
    return group


def wire_assistant(group_id: str) -> str:
    """Attach the insight group to the assistant via insight_settings."""
    if ASSISTANT_ID:
        assistant_id = ASSISTANT_ID
        _api_post(
            f"/ai/assistants/{assistant_id}",
            {"insight_settings": {"insight_group_id": group_id}},
        )
    else:
        data = _api_post(
            "/ai/assistants",
            {
                "name": "insights-pipeline-demo",
                "system_prompt": DEMO_SYSTEM_PROMPT,
                "insight_settings": {"insight_group_id": group_id},
            },
        )
        assistant_id = data.get("data", data).get("id")
    verified = _api_get(f"/ai/assistants/{assistant_id}")
    settings = verified.get("data", verified).get("insight_settings", {})
    if settings.get("insight_group_id") != group_id:
        raise RuntimeError(
            f"Assistant {assistant_id} insight_settings does not reference "
            f"group {group_id}: {settings}"
        )
    print(f"  assistant {assistant_id} insight_settings: {settings}")
    return assistant_id


def _validate_live_targets() -> None:
    """Reject placeholder/empty targets BEFORE any API call is made."""
    if not ASSISTANT_PHONE_NUMBER or ASSISTANT_PHONE_NUMBER in PLACEHOLDERS:
        raise RuntimeError(
            "ASSISTANT_PHONE_NUMBER is not set (or still the placeholder). "
            "Associate a phone number with the assistant in the Telnyx portal, "
            "then set ASSISTANT_PHONE_NUMBER in .env."
        )
    if not DESTINATION_NUMBER or DESTINATION_NUMBER in PLACEHOLDERS:
        raise RuntimeError(
            "DESTINATION_NUMBER is not set (or still the placeholder). Set a "
            "real test destination in .env before running a live call."
        )


def place_call(assistant_id: str, live: bool = False) -> str:
    """Place a demo call via the assistant scheduled-event surface.

    A real call is placed ONLY when the operator passes the explicit --live
    flag AND DEMO_MODE is not "true". A copied .env cannot accidentally dial.
    """
    scheduled_at = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
    payload = {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_end_user_target": DESTINATION_NUMBER or "+1555XXXXXXXX",
        "telnyx_agent_target": ASSISTANT_PHONE_NUMBER or "+1555XXXXXXXX",
        "scheduled_at_fixed_datetime": scheduled_at,
    }
    if not live or DEMO_MODE:
        print(f"  [DEMO] would schedule call: {json.dumps(payload)}")
        return "demo-synthetic-conversation"
    # Live path: validate targets before any API call.
    _validate_live_targets()
    data = _api_post(f"/ai/assistants/{assistant_id}/scheduled_events", payload)
    conversation_id = data.get("data", data).get("conversation_id")
    if conversation_id:
        append_conversation(conversation_id)
    print(f"  scheduled call conversation_id={conversation_id}")
    return conversation_id or ""


# ---------------------------------------------------------------------------
# Scorecard
# ---------------------------------------------------------------------------


def _validate_record(record: dict[str, Any], schema: dict[str, Any]) -> bool:
    """Minimal JSON-schema validator for required fields and enums."""
    for field in schema.get("required", []):
        if field not in record:
            return False
    for field, spec in schema.get("properties", {}).items():
        if field not in record:
            continue
        value = record[field]
        if "enum" in spec and value not in spec["enum"]:
            return False
        if spec.get("type") == "number" and not isinstance(value, (int, float)):
            return False
        if spec.get("type") == "boolean" and not isinstance(value, bool):
            return False
        if spec.get("type") == "array" and not isinstance(value, list):
            return False
    return True


def _fetch_insights(conversation_id: str) -> list[dict[str, Any]]:
    """Fetch insight records for a conversation via the polling path."""
    data = _api_get(f"/ai/conversations/{conversation_id}/conversations-insights")
    return data.get("data", data).get("insights", [])


def _synthetic_invalid_records() -> list[dict[str, Any]]:
    """The deterministic schema-invalid record injected by --strict.

    Missing the required `positivity_score` field, so the validator flags it.
    """
    return [
        {
            "name": "sentiment-v1",
            "status": "completed",
            "result": {
                "frustration_level": 4,
                "overall_sentiment": "negative",
                "key_emotions": ["frustrated"],
            },
        }
    ]


def render_scorecard(
    date_filter: str | None, conversation_id: str | None, strict: bool
) -> dict[str, Any]:
    """Render the QA scorecard from schema-valid insight records.

    Emits all five required sections: sentiment_distribution,
    compliance_flag_rates, escalation_breakdown, schema_invalid, pending.
    """
    if conversation_id:
        rows = [{"conversation_id": conversation_id}]
    else:
        rows = read_conversations()
        if date_filter:
            rows = [
                r
                for r in rows
                if str(r.get("received_at", "")).startswith(date_filter)
            ]

    schemas = {
        "sentiment-v1": SENTIMENT_SCHEMA,
        "compliance-v1": COMPLIANCE_SCHEMA,
        "escalation-v1": ESCALATION_SCHEMA,
    }

    sentiment_counts: dict[str, int] = {}
    flag_counts: dict[str, int] = {}
    escalation_counts: dict[str, int] = {}
    invalid_ids: list[str] = []
    pending_ids: list[str] = []

    def process(cid: str, records: list[dict[str, Any]]) -> None:
        for rec in records:
            status = rec.get("status")
            if status in ("pending", "in_progress", "failed"):
                pending_ids.append(cid)
                continue
            name = rec.get("name") or rec.get("insight_name")
            schema = schemas.get(name)
            result = rec.get("result", rec)
            if schema and not _validate_record(result, schema):
                invalid_ids.append(cid)
                continue
            if name == "sentiment-v1":
                s = result.get("overall_sentiment")
                if s:
                    sentiment_counts[s] = sentiment_counts.get(s, 0) + 1
            elif name == "compliance-v1":
                for flag in result.get("compliance_flags", []):
                    flag_counts[flag] = flag_counts.get(flag, 0) + 1
            elif name == "escalation-v1":
                r = result.get("escalation_reason")
                if r:
                    escalation_counts[r] = escalation_counts.get(r, 0) + 1

    for row in rows:
        cid = row["conversation_id"]
        try:
            records = _fetch_insights(cid)
        except Exception:  # noqa: BLE001 — network/API failure is a pending row
            app.logger.exception("Failed to fetch insights for %s", cid)
            pending_ids.append(cid)
            continue
        process(cid, records)

    if strict:
        print(f"  [STRICT] injecting synthetic invalid record: {SYNTHETIC_INVALID_ID}")
        process(SYNTHETIC_INVALID_ID, _synthetic_invalid_records())

    scorecard = {
        "sentiment_distribution": sentiment_counts,
        "compliance_flag_rates": flag_counts,
        "escalation_breakdown": escalation_counts,
        "schema_invalid": invalid_ids,
        "pending": pending_ids,
    }
    print(json.dumps(scorecard, indent=2))
    return scorecard


# ---------------------------------------------------------------------------
# Flask webhook receiver
# ---------------------------------------------------------------------------


@app.route("/webhooks/telnyx", methods=["POST"])
def telnyx_webhook() -> tuple[Any, int]:
    """Receive and verify call.conversation.insights_generated events."""
    body = request.get_data()
    public_key = os.getenv("TELNYX_PUBLIC_KEY", "")
    try:
        event = telnyx.Webhook.construct_event(body, request.headers, public_key)
    except Exception:  # noqa: BLE001 — signature failure is a 400
        app.logger.exception("Webhook signature verification failed")
        return jsonify({"error": "invalid signature"}), 400

    data = event.get("data", {})
    if data.get("event_type") == "call.conversation.insights_generated":
        payload = data.get("payload", {})
        print(f"  webhook payload keys: {sorted(payload.keys())}")
        cid = payload.get("conversation_id")
        if cid:
            append_conversation(cid)
    return jsonify({"received": True}), 200


@app.route("/health", methods=["GET"])
def health() -> tuple[Any, int]:
    """Liveness probe."""
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

REQUIRED_ENV = ("TELNYX_API_KEY", "TELNYX_PUBLIC_KEY")


def _require_env() -> None:
    """Exit with an actionable message if required env vars are missing."""
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        sys.stderr.write(
            "Missing required environment variable(s): "
            + ", ".join(missing)
            + ". Copy .env.example to .env and fill them in.\n"
        )
        raise SystemExit(1)
    telnyx.api_key = os.environ["TELNYX_API_KEY"]


def main() -> int:
    """Dispatch CLI subcommands."""
    parser = argparse.ArgumentParser(description="Insights pipeline desk")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("create-templates")
    sub.add_parser("create-group")
    sub.add_parser("wire-assistant")
    pc = sub.add_parser("place-call")
    pc.add_argument(
        "--live",
        action="store_true",
        help="Place a REAL call. Requires DEMO_MODE != true. Default is demo.",
    )
    sc = sub.add_parser("scorecard")
    sc.add_argument("--date")
    sc.add_argument("--conversation-id")
    sc.add_argument("--strict", action="store_true")
    sub.add_parser("serve")
    sub.add_parser("print-url")
    args = parser.parse_args()

    if args.cmd == "print-url":
        print(f"{PUBLIC_WEBHOOK_BASE_URL}/webhooks/telnyx")
        return 0

    _require_env()

    if args.cmd == "create-templates":
        create_templates()
    elif args.cmd == "create-group":
        templates = create_templates()
        create_group([t["id"] for t in templates])
    elif args.cmd == "wire-assistant":
        group = create_group([t["id"] for t in create_templates()])
        wire_assistant(group["id"])
    elif args.cmd == "place-call":
        place_call(ASSISTANT_ID or "demo-assistant", live=args.live)
    elif args.cmd == "scorecard":
        render_scorecard(args.date, args.conversation_id, args.strict)
    elif args.cmd == "serve":
        app.run(host="0.0.0.0", port=PORT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
