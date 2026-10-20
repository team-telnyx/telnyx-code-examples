"""Step 2 \u2014 submit flagged numbers for remediation.

POSTs the flagged set to the enterprise remediation endpoint, asserts the
202 Accepted contract (status: pending + the three counts), stores the
request id, and demonstrates the validation contract (400) for an
over-length call_purpose or a batch over 2,000 numbers.

Usage:
    python submit_remediation.py --purpose "..." --webhook https://...
    python submit_remediation.py --invalid-purpose
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
ENTERPRISE_ID = os.getenv("TELNYX_ENTERPRISE_ID", "")
API_KEY = os.getenv("TELNYX_API_KEY", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

MAX_NUMBERS = 2000
MAX_PURPOSE = 2000
MAX_EMAIL = 255
MAX_WEBHOOK = 2048
REQUEST_ID_FILE = Path("remediation_request_id.txt")


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def read_flagged(path: Path) -> list[str]:
    numbers: list[str] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if row and row[0].strip() and row[0].strip().lower() != "phone_number":
                numbers.append(row[0].strip())
    return numbers


def submit(numbers: list[str], purpose: str, webhook: str | None, email: str | None) -> dict:
    """POST the remediation request. Returns the parsed `data` envelope."""
    url = f"{API_BASE}/enterprises/{ENTERPRISE_ID}/reputation/remediation"
    body: dict = {"phone_numbers": numbers, "call_purpose": purpose}
    if webhook:
        body["webhook_url"] = webhook
    if email:
        body["contact_email"] = email
    resp = requests.post(url, headers=_headers(), json=body, timeout=60)
    resp.raise_for_status()
    return resp.json().get("data", {})


def _demo_submit(numbers: list[str], purpose: str, webhook: str | None) -> dict:
    return {
        "id": "demo-remediation-0001",
        "status": "pending",
        "phone_numbers_count": len(numbers),
        "phone_numbers_submitted": len(numbers),
        "phone_numbers_ineligible": 0,
        "call_purpose": purpose,
        "webhook_url": webhook,
    }


def _run_invalid_demo(purpose: str) -> int:
    """Demonstrate the documented 400 for over-length call_purpose / >2000 numbers.

    The validation demo always attempts the real POST against the API \u2014 the
    endpoint rejects the payload before any state change, so this is a safe
    read-only probe of the validation contract. In demo mode (no credentials)
    we cannot reach the API, so we print the documented 400 envelope and
    clearly label it as simulated, pointing at live mode for the real 400.
    """
    print("Validation contract demo (expect HTTP 400):")
    over_purpose = "x" * (MAX_PURPOSE + 1)
    over_batch = [f"+1555{i:07d}" for i in range(MAX_NUMBERS + 1)]
    cases = (
        (f"call_purpose length {len(over_purpose)} > {MAX_PURPOSE}",
         {"phone_numbers": ["+15550000001"], "call_purpose": over_purpose},
         {"errors": [{"code": "10009",
                      "title": f"call_purpose exceeds maximum length of {MAX_PURPOSE}"}]}),
        (f"phone_numbers count {len(over_batch)} > {MAX_NUMBERS}",
         {"phone_numbers": over_batch, "call_purpose": purpose},
         {"errors": [{"code": "10010",
                      "title": f"phone_numbers exceeds maximum of {MAX_NUMBERS} items"}]}),
    )

    if DEMO_MODE:
        print("  (DEMO_MODE=true \u2014 no credentials; envelopes below are SIMULATED.")
        print("   Set DEMO_MODE=false with TELNYX_API_KEY + TELNYX_ENTERPRISE_ID")
        print("   to observe the real server-side 400.)")
        for label, _body, envelope in cases:
            print(f"  {label} -> HTTP 400 (simulated)")
            print(f"    {json.dumps(envelope)}")
        return 0

    if not (API_KEY and ENTERPRISE_ID):
        print("error: TELNYX_API_KEY and TELNYX_ENTERPRISE_ID required in live mode",
              file=sys.stderr)
        return 2

    url = f"{API_BASE}/enterprises/{ENTERPRISE_ID}/reputation/remediation"
    for label, body, _envelope in cases:
        resp = requests.post(url, headers=_headers(), json=body, timeout=60)
        print(f"  {label} -> HTTP {resp.status_code}: {resp.text[:200]}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit flagged numbers for remediation.")
    parser.add_argument("--flagged", type=Path, default=Path("flagged.csv"))
    parser.add_argument("--purpose", default="Outbound appointment reminders for our dental clinic.")
    parser.add_argument("--webhook", default=None, help="webhook_url (max 2048 chars)")
    parser.add_argument("--email", default=None, help="contact_email (max 255 chars)")
    parser.add_argument("--invalid-purpose", action="store_true",
                        help="demonstrate the 400 validation contract")
    args = parser.parse_args()

    if args.invalid_purpose:
        return _run_invalid_demo(args.purpose)

    if len(args.purpose) > MAX_PURPOSE:
        print(f"error: call_purpose exceeds {MAX_PURPOSE} chars", file=sys.stderr)
        return 2
    if args.webhook and len(args.webhook) > MAX_WEBHOOK:
        print(f"error: webhook_url exceeds {MAX_WEBHOOK} chars", file=sys.stderr)
        return 2
    if args.email and len(args.email) > MAX_EMAIL:
        print(f"error: contact_email exceeds {MAX_EMAIL} chars", file=sys.stderr)
        return 2
    if not args.flagged.exists():
        print(f"error: {args.flagged} not found \u2014 run check_reputation.py first", file=sys.stderr)
        return 2

    numbers = read_flagged(args.flagged)
    if not 1 <= len(numbers) <= MAX_NUMBERS:
        print(f"error: need 1-{MAX_NUMBERS} numbers, got {len(numbers)}", file=sys.stderr)
        return 2
    if not DEMO_MODE and not (API_KEY and ENTERPRISE_ID):
        print("error: TELNYX_API_KEY and TELNYX_ENTERPRISE_ID required in live mode", file=sys.stderr)
        return 2

    try:
        data = _demo_submit(numbers, args.purpose, args.webhook) if DEMO_MODE else submit(
            numbers, args.purpose, args.webhook, args.email
        )
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        print(f"error: submit failed with HTTP {status}", file=sys.stderr)
        return 1

    # Assert the 202 Accepted contract before storing the id.
    for field in ("phone_numbers_count", "phone_numbers_submitted", "phone_numbers_ineligible"):
        if field not in data:
            print(f"error: 202 response missing {field}", file=sys.stderr)
            return 1
    if data.get("status") != "pending":
        print(f"error: expected status 'pending', got {data.get('status')!r}", file=sys.stderr)
        return 1

    print("202 Accepted \u2014 remediation request persisted:")
    print(json.dumps(data, indent=2))
    REQUEST_ID_FILE.write_text(str(data["id"]), encoding="utf-8")
    print(f"\nstored request id in {REQUEST_ID_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
