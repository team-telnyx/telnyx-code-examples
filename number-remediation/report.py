"""Step 4 \u2014 render the remediation report.

Reads the final remediation request and renders the five outcome buckets
(remediated, not_flagged, requires_review, ineligible, refused) plus the
meta-status and two-tier timing into remediation_report.md.

Usage:
    python report.py [--request-id ...] [--out remediation_report.md]
"""

from __future__ import annotations

import argparse
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
REQUEST_ID_FILE = Path("remediation_request_id.txt")

BUCKETS = ["remediated", "not_flagged", "requires_review", "ineligible", "refused"]
REVIEW_DOCS = "https://developers.telnyx.com/docs/number-reputation/remediation"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def fetch_request(request_id: str) -> dict:
    url = f"{API_BASE}/enterprises/{ENTERPRISE_ID}/reputation/remediation/{request_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def _demo_request(request_id: str) -> dict:
    """Deterministic demo request echoing the id under review."""
    return {
        "id": request_id,
        "status": "completed",
        "tier1_completed_at": "2026-07-20T12:05:00Z",
        "tier2_completed_at": "2026-07-20T12:31:00Z",
        "results": {
            "remediated": ["+15550000001"],
            "not_flagged": ["+15550000002"],
            "requires_review": ["+15550000003"],
            "ineligible": [],
            "refused": [],
        },
    }


def render(data: dict) -> str:
    results = data.get("results") or {}
    lines = [
        "# Number Reputation Remediation Report",
        "",
        f"- **Request ID:** `{data.get('id', 'unknown')}`",
        f"- **Meta-status:** `{data.get('status', 'unknown')}`",
        f"- **Tier 1 completed at:** {data.get('tier1_completed_at') or '_pending_'}",
        f"- **Tier 2 completed at:** {data.get('tier2_completed_at') or '_pending_'}",
        "",
        "## Outcome buckets",
        "",
        "| Bucket | Count |",
        "| --- | --- |",
    ]
    for bucket in BUCKETS:
        lines.append(f"| {bucket} | {len(results.get(bucket) or [])} |")
    lines.append("")

    for bucket in BUCKETS:
        numbers = results.get(bucket) or []
        lines.append(f"### {bucket} ({len(numbers)})")
        if bucket == "requires_review" and numbers:
            lines.append(f"See the [review guidance]({REVIEW_DOCS}) for next steps.")
        if numbers:
            lines.extend(f"- `{n}`" for n in numbers)
        else:
            lines.append("_none_")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the remediation report.")
    parser.add_argument("--request-id", default=None)
    parser.add_argument("--out", type=Path, default=Path("remediation_report.md"))
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

    try:
        data = _demo_request(request_id) if DEMO_MODE else fetch_request(request_id)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        print(f"error: fetch failed with HTTP {status}", file=sys.stderr)
        return 1

    args.out.write_text(render(data), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
