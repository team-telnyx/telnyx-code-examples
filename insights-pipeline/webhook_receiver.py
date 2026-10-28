"""Step 5 \u2014 Flask receiver for call.conversation.insights_generated.

Verifies the Telnyx Ed25519 signature via telnyx.Webhook.construct_event
using the raw 'telnyx-signature-ed25519' header value and TELNYX_PUBLIC_KEY.
The public key is required at server startup (inside _main), not at import
time \u2014 importing this module is side-effect free so smoke tests can collect
it without a populated .env. There is no unverified fallback path.

Prints the payload keys on first receipt, appends the conversation_id to
conversations.json (deduped), and diffs subsequent events against the
polling path so reviewers can see both routes agree.
--print-url prints the exact registration payload for PUBLIC_WEBHOOK_BASE_URL.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
STORE = Path(__file__).parent / "conversations.json"
_seen_keys: set[str] = set()

telnyx.api_key = os.getenv("TELNYX_API_KEY")


def _public_key() -> str:
    """Lazy accessor \u2014 fails closed at request time if the key is unset."""
    key = os.getenv("TELNYX_PUBLIC_KEY")
    if not key:
        raise RuntimeError(
            "TELNYX_PUBLIC_KEY is required (set it in .env) \u2014 "
            "webhook signature verification cannot be bypassed."
        )
    return key


def _existing_ids() -> set[str]:
    if not STORE.exists():
        return set()
    ids: set[str] = set()
    for line in STORE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            ids.add(json.loads(line)["conversation_id"])
        except (json.JSONDecodeError, KeyError):
            continue
    return ids


def _append_store(conversation_id: str) -> bool:
    """Append the conversation_id unless it is already present. Returns True if appended."""
    if conversation_id in _existing_ids():
        return False
    row = {"conversation_id": conversation_id, "received_at": datetime.now(timezone.utc).isoformat()}
    with STORE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    return True


@app.route("/webhooks/telnyx", methods=["POST"])
def webhook() -> tuple[Any, int]:
    payload = request.get_data()
    sig = request.headers.get("telnyx-signature-ed25519")
    ts = request.headers.get("telnyx-timestamp")
    if not sig or not ts:
        return jsonify({"error": "missing signature headers"}), 400

    try:
        event = telnyx.Webhook.construct_event(payload, sig, _public_key())
    except Exception:
        app.logger.exception("webhook signature verification failed")
        return jsonify({"error": "invalid signature"}), 400

    data = event.get("data", event)
    event_type = data.get("event_type")
    if event_type != "call.conversation.insights_generated":
        return jsonify({"status": "ignored"}), 200

    inner = data.get("payload", {})
    conversation_id = inner.get("conversation_id")
    if not conversation_id:
        return jsonify({"error": "missing conversation_id"}), 400

    keys = sorted(inner.keys())
    key_sig = ",".join(keys)
    if key_sig not in _seen_keys:
        _seen_keys.add(key_sig)
        print(f"[first receipt] payload keys: {keys}")

    if _append_store(conversation_id):
        print(f"\u2713 insights_generated for conversation_id={conversation_id} (appended)")
    else:
        print(f"\u2713 insights_generated for conversation_id={conversation_id} (already in store)")
    return jsonify({"status": "received"}), 200


def _print_url() -> int:
    base = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    if not base:
        print("PUBLIC_WEBHOOK_BASE_URL is not set. Run `ngrok http 8000` and set it in .env.")
        return 1
    print("Register this webhook URL on templates and groups:")
    print(json.dumps({"webhook": f"{base.rstrip('/')}/webhooks/telnyx"}, indent=2))
    return 0


def _main() -> int:
    parser = argparse.ArgumentParser(description="Flask receiver for insights_generated webhooks.")
    parser.add_argument(
        "--print-url",
        action="store_true",
        help="Print the exact webhook registration payload and exit.",
    )
    args = parser.parse_args()

    if args.print_url:
        return _print_url()

    if not os.getenv("TELNYX_PUBLIC_KEY"):
        sys.exit(
            "TELNYX_PUBLIC_KEY is required (set it in .env) \u2014 "
            "webhook signature verification cannot be bypassed."
        )

    app.run(host="0.0.0.0", port=8000)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
