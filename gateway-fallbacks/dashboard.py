#!/usr/bin/env python3
"""Optional live dashboard for the gateway-fallbacks demo.

Serves a single-page UI (dashboard.html) that polls the gateway for live
proof and can fire the two demo calls server-side:

  GET  /                          dashboard.html
  GET  /api/state                 group policy, budget/reservation, spend
                                  events (failover rows highlighted), usage
  POST /api/actions/normal-call   one non-stream completion against the primary
  POST /api/actions/force-failure the streaming 1s-timeout forced-failure run

Security contract:
- Binds to 127.0.0.1 by default — do not expose to untrusted networks.
- The token key is read ONLY from the GATEWAY_TOKEN_KEY environment variable;
  it is never accepted from, or returned in, any HTTP request/response.
- Errors return generic messages; details go to the server log only.

This is presentation glue for the five-script demo, not part of the DEV-1352
acceptance surface. provision.py / teardown.py remain the CLI provisioning path.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, send_file

import gateway
import inference
import ledger
from gateway import PRIMARY_MODEL, chat_completion, spend_date_range

app = Flask(__name__)
DASHBOARD_HTML = Path(__file__).parent / "dashboard.html"

NORMAL_CALL_PROMPT = "Say hello in one word."

logging.basicConfig(level=logging.INFO)


def _state() -> dict[str, str] | None:
    return gateway.state_or_none()


def _token_key() -> str | None:
    return os.environ.get("GATEWAY_TOKEN_KEY") or None


def _jsonable(value: Any) -> Any:
    """SDK response models are pydantic; convert them (and any nested models)
    to plain dicts before jsonify."""
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value


def serialize_event(event: Any) -> dict[str, Any]:
    return {
        "created_at": str(event.created_at),
        "requested_model": event.requested_model,
        "model": event.model,
        "attempts": event.attempts,
        "status": event.status,
        "cache_hit": event.cache_hit,
        "cost": event.cost,
        "is_failover": event.requested_model != event.model,
    }


def _usage_payload(client: Any, group_id: str, start_date: str, end_date: str) -> dict[str, Any]:
    summary, warning = ledger.usage_summary_safe(client, group_id, start_date, end_date)
    if summary is None:
        return {"warning": warning}
    totals = summary.data.totals
    return {
        "totals": {
            "requests": totals.requests,
            "cache_hits": totals.cache_hits,
            "failed_requests": totals.failed_requests,
            "input_tokens": totals.input_tokens,
            "output_tokens": totals.output_tokens,
            "spend": totals.spend,
            "reserved_spend": totals.reserved_spend,
        },
        "by_model": [
            {
                "model": by.model,
                "requests": by.requests,
                "cache_hits": by.cache_hits,
                "failed_requests": by.failed_requests,
            }
            for by in summary.data.by_model[:5]
        ],
    }


@app.route("/")
def index() -> Any:
    return send_file(DASHBOARD_HTML)


@app.route("/api/state", methods=["GET"])
def api_state() -> Any:
    state = _state()
    if state is None:
        return jsonify({
            "status": "unprovisioned",
            "instructions": "Run `python provision.py`, export GATEWAY_TOKEN_KEY, then refresh.",
        }), 200
    client = ledger.mgmt_client()
    try:
        group = client.llm_token_gateway.token_groups.retrieve(state["group_id"]).data
    except Exception:
        app.logger.exception("reading the token group failed")
        return jsonify({
            "status": "error",
            "message": "could not read the token group — check TELNYX_API_KEY and the state file",
        }), 200
    start_date, end_date = spend_date_range()
    try:
        events = ledger.fetch_events(client, state["key_id"], start_date, end_date)
    except Exception:
        app.logger.exception("reading spend events failed")
        events = []
    return jsonify({
        "status": "ready",
        "group": {
            "id": group.id,
            "allowed_models": group.allowed_models,
            "fallbacks": group.fallbacks,
            "retries": _jsonable(group.retries),
            "spend": group.spend,
            "reserved_spend": group.reserved_spend,
            "max_budget": group.max_budget,
            "budget_duration": group.budget_duration,
            "cache_ttl": group.cache_ttl,
        },
        "token_key_present": bool(_token_key()),
        "window": {"start_date": start_date, "end_date": end_date},
        "events": [serialize_event(e) for e in reversed(events)],
        "usage": _usage_payload(client, state["group_id"], start_date, end_date),
    })


@app.route("/api/actions/normal-call", methods=["POST"])
def api_normal_call() -> Any:
    token_key = _token_key()
    if not token_key:
        return jsonify({"error": "GATEWAY_TOKEN_KEY is not set — export the secret provision.py printed"}), 400
    try:
        result = chat_completion(token_key, PRIMARY_MODEL, NORMAL_CALL_PROMPT)
        return jsonify({"result": result}), 200
    except Exception:
        app.logger.exception("normal call failed")
        return jsonify({"error": "inference call failed — check server logs"}), 502


@app.route("/api/actions/force-failure", methods=["POST"])
def api_force_failure() -> Any:
    token_key = _token_key()
    if not token_key:
        return jsonify({"error": "GATEWAY_TOKEN_KEY is not set — export the secret provision.py printed"}), 400
    try:
        outcome = inference.run_forced_failure(token_key)
        return jsonify({"outcome": outcome}), 200
    except Exception:
        app.logger.exception("forced-failure run failed")
        return jsonify({"error": "forced-failure run failed — check server logs"}), 502


@app.errorhandler(404)
def not_found(_exc: Any) -> Any:
    return jsonify({"error": "not found"}), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "8079")))
