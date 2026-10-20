"""Step 1 \u2014 flagged-number intake.

Reads enterprise-scoped reputation data for each number in a CSV, prints
spam_risk / scores / spam_category / last_refreshed_at, separates flagged
from clean numbers, and writes the flagged set to flagged.csv.

Usage:
    python check_reputation.py --numbers numbers.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
ENTERPRISE_ID = os.getenv("TELNYX_ENTERPRISE_ID", "")
API_KEY = os.getenv("TELNYX_API_KEY", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# A number is "flagged" when spam_risk is medium/high or a spam_category is set.
FLAGGED_RISKS = {"medium", "high"}


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def read_numbers(path: Path) -> list[str]:
    """Read E.164 numbers from a CSV (first column, header optional)."""
    numbers: list[str] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if not row:
                continue
            value = row[0].strip()
            if not value or value.lower() in {"number", "phone_number", "e164"}:
                continue
            numbers.append(value)
    return numbers


def fetch_reputation(number: str) -> dict:
    """GET enterprise-scoped reputation data for a single number.

    The E.164 leading `+` must be percent-encoded (`%2B`) in the path segment
    per the API contract; an unencoded `+` is read as a space by many servers.
    """
    encoded = quote(number, safe="")
    url = f"{API_BASE}/enterprises/{ENTERPRISE_ID}/reputation/phone_numbers/{encoded}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def is_flagged(record: dict) -> bool:
    risk = str(record.get("spam_risk", "")).lower()
    return risk in FLAGGED_RISKS or bool(record.get("spam_category"))


def _demo_record(number: str) -> dict:
    """Deterministic demo data so the sample runs without live credentials."""
    flagged = sum(ord(c) for c in number) % 2 == 0
    return {
        "phone_number": number,
        "spam_risk": "high" if flagged else "low",
        "spam_score": 82 if flagged else 4,
        "spam_category": "telemarketing" if flagged else None,
        "last_refreshed_at": "2026-07-20T12:00:00Z",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read reputation data and split flagged numbers.")
    parser.add_argument("--numbers", required=True, type=Path, help="CSV of E.164 numbers")
    parser.add_argument("--out", type=Path, default=Path("flagged.csv"), help="flagged output CSV")
    args = parser.parse_args()

    if not args.numbers.exists():
        print(f"error: {args.numbers} not found", file=sys.stderr)
        return 2
    if not DEMO_MODE and not (API_KEY and ENTERPRISE_ID):
        print("error: TELNYX_API_KEY and TELNYX_ENTERPRISE_ID required in live mode", file=sys.stderr)
        return 2

    numbers = read_numbers(args.numbers)
    if not numbers:
        print("error: no numbers found in input CSV", file=sys.stderr)
        return 2

    flagged: list[str] = []
    unknown: list[str] = []
    print(f"{'number':<18}{'spam_risk':<12}{'score':<8}{'category':<18}last_refreshed_at")
    print("-" * 80)
    for number in numbers:
        try:
            record = _demo_record(number) if DEMO_MODE else fetch_reputation(number)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            if status == 404:
                # 404 means the number is unknown / not in this enterprise's
                # reputation scope \u2014 NOT clean. Track it separately so the
                # operator knows the flagged set may be incomplete.
                unknown.append(number)
                print(f"{number:<18}unknown (HTTP 404 \u2014 not in enterprise scope)", file=sys.stderr)
            else:
                print(f"{number:<18}error: HTTP {status}", file=sys.stderr)
            continue
        print(
            f"{number:<18}{str(record.get('spam_risk', '-')):<12}"
            f"{str(record.get('spam_score', '-')):<8}"
            f"{str(record.get('spam_category') or '-'):<18}"
            f"{record.get('last_refreshed_at', '-')}"
        )
        if is_flagged(record):
            flagged.append(number)

    with args.out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["phone_number"])
        writer.writerows([[n] for n in flagged])

    clean = len(numbers) - len(flagged) - len(unknown)
    print("-" * 80)
    print(f"flagged: {len(flagged)}  clean: {clean}  unknown: {len(unknown)}")
    if unknown:
        print(
            f"warning: {len(unknown)} number(s) not in enterprise scope \u2014 "
            "the flagged set may be incomplete",
            file=sys.stderr,
        )
    print(f"wrote {len(flagged)} flagged numbers to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
