# SELF-REVIEW:
# ✅ Cancels every event in the manifest via DELETE .../scheduled_events/{event_id}
# ✅ Writes cancelled_ids into the manifest so report.py counts them as cancelled (not failed)
# ✅ Demo mode default: prints the DELETE it would issue, no live request
# ✅ No credentials in code; TELNYX_API_KEY from env

"""Step 4 — teardown: cancel all created events.

Contacts removed from the CSV after creation are cancelled before dispatch via
`DELETE .../scheduled_events/{event_id}`. Cancelled events are counted as
`cancelled` in the scorecard, never as failures.

This script reads `campaign_manifest.json`, issues the DELETE for each event,
and records the successfully-cancelled event IDs into `manifest["cancelled_ids"]`
so `report.py` can separate them from dead-lettered failures.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
API_KEY = os.getenv("TELNYX_API_KEY", "")
ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("1", "true", "yes")


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _events_url() -> str:
    return f"{API_BASE}/ai/assistants/{ASSISTANT_ID}/scheduled_events"


def cancel_event(event_id: str) -> bool:
    """DELETE one scheduled event. Returns True when the API reports it cancelled."""
    resp = requests.delete(f"{_events_url()}/{event_id}", headers=_headers(), timeout=30)
    if resp.status_code == 200:
        return True
    # 400 = already dispatched/terminal, 404 = gone, 500 = server error: log and keep going.
    print(f"  ⚠️  {event_id}: DELETE returned {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False


def _main() -> int:
    parser = argparse.ArgumentParser(description="Cancel all scheduled events in the campaign manifest.")
    parser.add_argument("--manifest", type=Path, default=Path("campaign_manifest.json"))
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"error: {args.manifest} not found — run create_campaign.py first", file=sys.stderr)
        return 2

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    events = manifest.get("events", [])
    if not events:
        print("No events in manifest; nothing to cancel.")
        return 0

    if not DEMO_MODE and not (API_KEY and ASSISTANT_ID):
        print("error: TELNYX_API_KEY and TELNYX_ASSISTANT_ID are required in live mode", file=sys.stderr)
        return 2

    cancelled: list[str] = list(manifest.get("cancelled_ids", []))
    print(f"Cancelling {len(events)} event(s) for campaign {manifest.get('campaign_id', '')}\n")

    for entry in events:
        event_id = entry.get("event_id", "")
        if not event_id:
            continue
        if DEMO_MODE:
            print(f"[demo] would DELETE {_events_url()}/{event_id}")
            cancelled.append(event_id)
            continue
        if cancel_event(event_id):
            print(f"[live] cancelled {event_id}")
            cancelled.append(event_id)

    manifest["cancelled_ids"] = sorted(set(cancelled))
    args.manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nWrote {len(manifest['cancelled_ids'])} cancelled id(s) to {args.manifest}. Next: python report.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
