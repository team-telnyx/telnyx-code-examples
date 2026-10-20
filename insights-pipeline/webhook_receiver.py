"""Step 5 - receive call.conversation.insights_generated.

FastAPI receiver that verifies the Telnyx Ed25519 signature via the documented
SDK primitive (``telnyx.Webhook.construct_event``), prints the payload keys on
first receipt, and appends the conversation id to the local JSON-lines store.
``--print-url`` prints the exact registration payload.

Dedupe is derived from the on-disk store, not an in-process set, so restarts
do not re-append the same conversation. The read-check-append is guarded by a
lock so concurrent deliveries (Telnyx retries on non-2xx) cannot interleave
writes or double-append.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import telnyx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response

load_dotenv()

STORE = Path(os.getenv("CONVERSATIONS_STORE", "conversations.json"))
app = FastAPI(title="Structured-Insights Webhook Receiver")
_STORE_LOCK = threading.Lock()


def _public_key() -> str:
    key = os.getenv("TELNYX_PUBLIC_KEY")
    if not key:
        sys.exit(
            "TELNYX_PUBLIC_KEY is not set. Copy the public key from the Telnyx "
            "portal into .env. Refusing to start without it (fail closed)."
        )
    return key


def _store_ids() -> set[str]:
    if not STORE.exists():
        return set()
    ids: set[str] = set()
    for line in STORE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ids.add(json.loads(line)["conversation_id"])
        except (json.JSONDecodeError, KeyError):
            continue
    return ids


def _append_row(conversation_id: str) -> None:
    """Append a row under a lock, creating the parent dir if needed."""
    STORE.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "conversation_id": conversation_id,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    with _STORE_LOCK:
        with STORE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")


def _append_if_new(conversation_id: str) -> bool:
    """Read-check-append atomically. Returns True if a row was appended."""
    STORE.parent.mkdir(parents=True, exist_ok=True)
    with _STORE_LOCK:
        if conversation_id in _store_ids():
            return False
        row = {
            "conversation_id": conversation_id,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
        with STORE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")
        return True


def _field(obj: Any, name: str, default: Any = None) -> Any:
    """Read a field from either a typed SDK object or a plain dict."""
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


@app.post("/webhooks/telnyx")
async def receive(request: Request) -> Response:
    raw = await request.body()
    headers = dict(request.headers)
    try:
        event = telnyx.Webhook.construct_event(raw, headers, _public_key())
    except Exception:
        print("Webhook signature verification failed", file=sys.stderr)
        return Response(status_code=400)

    data = _field(event, "data")
    event_type = _field(data, "event_type")
    if event_type != "call.conversation.insights_generated":
        return Response(status_code=200)

    payload = _field(data, "payload")
    conversation_id = _field(payload, "conversation_id")
    if not conversation_id:
        return Response(status_code=200)

    if _append_if_new(conversation_id):
        keys = sorted(payload.keys()) if isinstance(payload, dict) else sorted(
            k for k in vars(payload) if not k.startswith("_")
        )
        print(f"insights_generated payload keys: {keys}")
    return Response(status_code=200)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Run the insights webhook receiver.")
    parser.add_argument("--print-url", action="store_true", help="Print the registration payload.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    base = os.getenv("PUBLIC_WEBHOOK_BASE_URL")
    if args.print_url:
        if not base:
            sys.exit("PUBLIC_WEBHOOK_BASE_URL is not set. Run `ngrok http 8000` and set it.")
        print(json.dumps({"webhook": f"{base.rstrip('/')}/webhooks/telnyx"}, indent=2))
        return

    _public_key()  # fail closed before serving

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    _main()
