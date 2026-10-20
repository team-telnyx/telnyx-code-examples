"""Step 3a \u2014 webhook receiver for the tiered remediation events.

Flask app that verifies the Telnyx Ed25519 signature and logs the three
tiered events: number_reputation.remediation.tier1_complete, .completed,
and .failed. Received events are appended to remediation_events.jsonl so
the webhook observation path can be reconciled with the final report.

Usage:
    python webhook_receiver.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
EVENTS_FILE = Path("remediation_events.jsonl")
HANDLED_EVENTS = {
    "number_reputation.remediation.tier1_complete",
    "number_reputation.remediation.completed",
    "number_reputation.remediation.failed",
}

# The Telnyx client is a local crypto helper for signature verification; it is
# instantiated once at module scope rather than per request. The public key
# presence check is deferred to request time (see remediation_hook) so that
# importing this module never raises \u2014 a fresh clone without .env must still
# import cleanly for the smoke test and for `--help`-style introspection.
_client = telnyx.Client(api_key=os.getenv("TELNYX_API_KEY", ""))


def verify_and_parse(payload: bytes, headers: dict) -> dict:
    """Verify the Telnyx Ed25519 signature and return the parsed event.

    Raises whatever the SDK raises on verification failure; the caller maps
    any such failure to a 401 per the API.md contract.
    """
    return _client.webhooks.unwrap(payload.decode("utf-8"), headers, TELNYX_PUBLIC_KEY)


def _persist_event(event_type: str, payload: dict) -> None:
    """Append the observed event to remediation_events.jsonl."""
    record = {"event_type": event_type, "payload": payload}
    with EVENTS_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")


@app.route("/hooks/remediation", methods=["POST"])
def remediation_hook():
    if not TELNYX_PUBLIC_KEY:
        app.logger.error("TELNYX_PUBLIC_KEY is not configured; cannot verify signatures")
        return jsonify({"error": "webhook verification not configured"}), 500

    try:
        event = verify_and_parse(request.get_data(), request.headers)
    except Exception:
        # Any failure from unwrap (signature mismatch, malformed JSON, missing
        # headers) is a verification failure per the API.md contract: 401.
        app.logger.exception("webhook signature verification failed")
        return jsonify({"error": "invalid signature"}), 401

    event_type = event.get("data", {}).get("event_type", "")
    payload = event.get("data", {}).get("payload", {})
    request_id = payload.get("id") or payload.get("request_id")
    status = payload.get("status")

    if event_type in HANDLED_EVENTS:
        app.logger.info("remediation event %s request=%s status=%s", event_type, request_id, status)
        print(f"[event] {event_type} request={request_id} status={status}")
        if event_type.endswith("tier1_complete"):
            print("  tier-1 review done, continuing to tier 2")
        elif event_type.endswith("completed"):
            print(f"  results: {payload.get('results')}")
        else:
            print(f"  failure reason: {payload.get('failure_reason', 'unknown')}")
        _persist_event(event_type, payload)
    else:
        app.logger.info("ignoring unhandled event type %s", event_type)

    return jsonify({"received": True}), 200


def main() -> int:
    if not TELNYX_PUBLIC_KEY:
        print(
            "error: TELNYX_PUBLIC_KEY is required to verify webhook signatures. "
            "Set it in .env before starting the receiver.",
            file=sys.stderr,
        )
        return 2
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
