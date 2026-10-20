"""Step 3b \u2014 poll the remediation request (no-webhook fallback).

Polls GET .../reputation/remediation/{id} every 60 s, printing status
transitions through in_progress to completed, with tier1_completed_at /
tier2_completed_at when present.

Usage:
    python poll_remediation.py [--interval 60] [--once] [--max-polls 60]
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
ENTERPRISE_ID = os.getenv("TELNYX_ENTERPRISE_ID", "")
API_KEY = os.getenv("TELNYX_API_KEY", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
REQUEST_ID_FILE = Path("remediation_request_id.txt")

TERMINAL = {"completed", "failed", "cancelled"}
DEFAULT_MAX_POLLS = 60  # 60 polls * 60 s = 1 hour


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def fetch_request(request_id: str) -> dict:
    url = f"{API_BASE}/enterprises/{ENTERPRISE_ID}/reputation/remediation/{request_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def _demo_states(request_id: str) -> list[dict]:
    """Deterministic transition sequence for demo mode."""
    return [
        {"id": request_id, "status": "pending"},
        {"id": request_id, "status": "in_progress"},
        {"id": request_id, "status": "in_progress",
         "tier1_completed_at": "2026-07-20T12:05:00Z"},
        {"id": request_id, "status": "completed",
         "tier1_completed_at": "2026-07-20T12:05:00Z",
         "tier2_completed_at": "2026-07-20T12:31:00Z",
         "results": {
             "remediated": ["+15550000001"],
             "not_flagged": ["+15550000002"],
             "requires_review": ["+15550000003"],
             "ineligible": [],
             "refused": [],
         }},
    ]


def _print_status(data: dict) -> None:
    print(f"status: {data.get('status')}")
    for key in ("tier1_completed_at", "tier2_completed_at"):
        if data.get(key):
            print(f"  {key}: {data[key]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll a remediation request.")
    parser.add_argument("--request-id", default=None)
    parser.add_argument("--interval", type=int, default=60, help="seconds between polls")
    parser.add_argument("--once", action="store_true", help="single poll, no loop")
    parser.add_argument("--max-polls", type=int, default=DEFAULT_MAX_POLLS,
                        help=f"max polls before giving up (default {DEFAULT_MAX_POLLS})")
    args = parser.parse_args()

    request_id = args.request_id
    if not request_id and REQUEST_ID_FILE.exists():
        request_id = REQUEST_ID_FILE.read_text(encoding="utf-8").strip()
    if not request_id:
        print("error: no request id \u2014 run submit_remediation.py first or pass --request-id",
              file=sys.stderr)
        return 2
    if not DEMO_MODE and not (API_KEY and ENTERPRISE_ID):
        print("error: TELNYX_API_KEY and TELNYX_ENTERPRISE_ID required in live mode", file=sys.stderr)
        return 2

    if DEMO_MODE:
        for state in _demo_states(request_id):
            _print_status(state)
            if state["status"] in TERMINAL or args.once:
                break
        return 0

    polls = 0
    while True:
        try:
            data = fetch_request(request_id)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            print(f"error: poll failed with HTTP {status}", file=sys.stderr)
            return 1
        _print_status(data)
        if data.get("status") in TERMINAL or args.once:
            return 0
        polls += 1
        if polls >= args.max_polls:
            print(
                f"error: exceeded --max-polls ({args.max_polls}); request {request_id} "
                f"still in status {data.get('status')!r}",
                file=sys.stderr,
            )
            return 1
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
