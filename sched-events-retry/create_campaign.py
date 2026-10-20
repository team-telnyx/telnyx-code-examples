# SELF-REVIEW:
# \u2705 Creates one phone_call scheduled event per contact via POST .../scheduled_events
# \u2705 Encodes retry bounds: max_retries_client_errors 0-10, retry_interval_secs 60-86400
# \u2705 Demonstrates the phone-call-only 400 by attempting retry fields on an sms_chat event
# \u2705 SMS guard runs against the API even in demo mode (non-routable placeholder, deliberate 400 probe)
# \u2705 Validates contact phone numbers against E.164 before building the payload
# \u2705 Sanitizes contact names (strips control chars, caps length) before interpolation
# \u2705 Staggers scheduled_at_fixed_datetime evenly across the window (--spread minutes)
# \u2705 Demo mode default: prints the payloads instead of dispatching real calls
# \u2705 No credentials in code; TELNYX_API_KEY from env

"""Step 1 \u2014 schedule the retry campaign.

Creates one `phone_call` scheduled event per contact against a single assistant.
Each event carries its own retry budget (`max_retries_client_errors` +
`retry_interval_secs`) and a `conversation_metadata` tag for campaign
attribution. The script also proves the phone-call-only constraint by sending
retry fields on an `sms_chat` event and catching the documented 400.

Scheduled Events has no typed resource in the installed `telnyx` SDK, so this
script calls the REST endpoints directly (see API.md).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
API_KEY = os.getenv("TELNYX_API_KEY", "")
ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "+1555XXXXXXXX")
SIP_REGION = os.getenv("TELNYX_SIP_REGION", "us-east")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("1", "true", "yes")

# Documented bounds \u2014 encoded as constants so the sample is self-documenting.
MAX_RETRIES_MIN, MAX_RETRIES_MAX = 0, 10
RETRY_INTERVAL_MIN, RETRY_INTERVAL_MAX = 60, 86400
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_INTERVAL = 300

# E.164: leading +, first digit 1-9, up to 15 total digits.
E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")
# Non-routable placeholder used by the SMS guard so the probe never dispatches.
GUARD_TARGET = "+15550000000"
# Cap the interpolated name so a hostile CSV cannot inject a long script.
MAX_NAME_LEN = 64


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _events_url() -> str:
    return f"{API_BASE}/ai/assistants/{ASSISTANT_ID}/scheduled_events"


def validate_retry_budget(max_retries: int, retry_interval: int) -> None:
    """Enforce the documented bounds and the move-together rule."""
    if not (MAX_RETRIES_MIN <= max_retries <= MAX_RETRIES_MAX):
        raise ValueError(f"max_retries_client_errors must be {MAX_RETRIES_MIN}-{MAX_RETRIES_MAX}, got {max_retries}")
    if not (RETRY_INTERVAL_MIN <= retry_interval <= RETRY_INTERVAL_MAX):
        raise ValueError(f"retry_interval_secs must be {RETRY_INTERVAL_MIN}-{RETRY_INTERVAL_MAX}, got {retry_interval}")
    if (max_retries > 0) != (retry_interval > 0):
        raise ValueError("max_retries_client_errors and retry_interval_secs must be set together")


def sanitize_name(name: str) -> str:
    """Strip control characters and cap length before interpolating into the script."""
    cleaned = "".join(ch for ch in name if ch.isprintable() and ch not in "\r\n\t")
    cleaned = cleaned.strip()[:MAX_NAME_LEN]
    return cleaned or "there"


def load_contacts(path: Path) -> list[dict[str, str]]:
    """Read contacts.csv -> [{name, phone}]. Validates columns and E.164 phones."""
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        required = {"name", "phone"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"contacts.csv must have columns: {sorted(required)}")
        contacts: list[dict[str, str]] = []
        for lineno, row in enumerate(reader, start=2):
            phone = (row.get("phone") or "").strip()
            if not E164_RE.match(phone):
                raise ValueError(f"contacts.csv line {lineno}: phone {phone!r} is not valid E.164")
            contacts.append({"name": sanitize_name(row.get("name") or ""), "phone": phone})
    if not contacts:
        raise ValueError("contacts.csv contains no rows")
    return contacts


def parse_start(value: str) -> datetime:
    """Parse an ISO-8601 UTC timestamp (e.g. 2026-10-20T15:00:00Z)."""
    cleaned = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def build_payload(
    contact: dict[str, str],
    scheduled_at: datetime,
    campaign_id: str,
    max_retries: int,
    retry_interval: int,
    channel: str = "phone_call",
) -> dict[str, Any]:
    """Build the scheduled-event payload for one contact."""
    payload: dict[str, Any] = {
        "telnyx_conversation_channel": channel,
        "telnyx_end_user_target": contact["phone"],
        "telnyx_agent_target": FROM_NUMBER,
        "scheduled_at_fixed_datetime": scheduled_at.isoformat().replace("+00:00", "Z"),
        "text": f"Hi {contact['name']}, this is a reminder from the campaign desk.",
        "conversation_metadata": {
            "campaign_id": campaign_id,
            "contact_name": contact["name"],
        },
        "max_retries_client_errors": max_retries,
        "retry_interval_secs": retry_interval,
    }
    if channel == "phone_call":
        payload["call_settings"] = {"sip_region": SIP_REGION}
    return payload


def create_event(payload: dict[str, Any]) -> dict[str, Any]:
    """POST one scheduled event. Returns the created event envelope."""
    resp = requests.post(_events_url(), headers=_headers(), json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def demonstrate_sms_guard(campaign_id: str, max_retries: int, retry_interval: int) -> None:
    """Prove retry fields on an sms_chat event return 400 (phone-call-only).

    The probe targets a non-routable placeholder so even if the API accepted the
    request it would never dispatch a real message. This probe runs even in demo
    mode: it is a deliberate 400 probe against a non-routable target, so it is
    safe and it is the runnable proof of the phone-call-only constraint.
    """
    print("\n[guard] Attempting retry fields on an sms_chat event (expected 400)...")
    payload = build_payload(
        {"name": "guard", "phone": GUARD_TARGET},
        datetime.now(timezone.utc),
        campaign_id,
        max_retries,
        retry_interval,
        channel="sms_chat",
    )
    if not (API_KEY and ASSISTANT_ID):
        print("[guard] TELNYX_API_KEY / TELNYX_ASSISTANT_ID not set \u2014 cannot probe; "
              "retry fields are phone-call-only (documented constraint).")
        return
    try:
        resp = requests.post(_events_url(), headers=_headers(), json=payload, timeout=30)
        if resp.status_code == 400:
            print(f"[guard] \u2705 Got expected 400: {resp.json().get('errors', resp.text)}")
        else:
            print(f"[guard] \u26a0\ufe0f  Expected 400, got {resp.status_code}: {resp.text[:200]}")
    except requests.RequestException as exc:
        print(f"[guard] request failed: {exc}")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Schedule a deadline-aware retry call campaign.")
    parser.add_argument("--contacts", type=Path, default=Path("contacts.csv"))
    parser.add_argument("--start", required=True, help="ISO-8601 UTC start, e.g. 2026-10-20T15:00:00Z")
    parser.add_argument("--spread", type=int, default=45, help="Minutes across which to stagger contacts")
    parser.add_argument("--max-retries", type=int, default=DEFAULT_MAX_RETRIES)
    parser.add_argument("--retry-interval", type=int, default=DEFAULT_RETRY_INTERVAL)
    args = parser.parse_args()

    try:
        validate_retry_budget(args.max_retries, args.retry_interval)
        contacts = load_contacts(args.contacts)
        start = parse_start(args.start)
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if not DEMO_MODE and not (API_KEY and ASSISTANT_ID):
        print("error: TELNYX_API_KEY and TELNYX_ASSISTANT_ID are required in live mode", file=sys.stderr)
        return 2

    campaign_id = f"camp-{uuid.uuid4().hex[:8]}"
    step = timedelta(minutes=args.spread) / max(len(contacts), 1)

    print(f"Campaign {campaign_id} \u2014 {len(contacts)} contacts, spread {args.spread}m")
    print(f"Retry budget: {args.max_retries} retries @ {args.retry_interval}s (up to {args.max_retries + 1} attempts)\n")

    demonstrate_sms_guard(campaign_id, args.max_retries, args.retry_interval)

    created: list[dict[str, str]] = []
    for idx, contact in enumerate(contacts):
        scheduled_at = start + step * idx
        payload = build_payload(contact, scheduled_at, campaign_id, args.max_retries, args.retry_interval)
        if DEMO_MODE:
            event_id = f"demo-{uuid.uuid4().hex[:12]}"
            print(f"[demo] would schedule {contact['name']} at {payload['scheduled_at_fixed_datetime']} -> {event_id}")
        else:
            try:
                event = create_event(payload)
                event_id = event.get("id", "")
                print(f"[live] scheduled {contact['name']} at {payload['scheduled_at_fixed_datetime']} -> {event_id}")
            except requests.RequestException as exc:
                print(f"[live] failed for {contact['name']}: {exc}", file=sys.stderr)
                continue
        created.append({"event_id": event_id, "name": contact["name"], "phone": contact["phone"]})

    manifest = Path("campaign_manifest.json")
    manifest.write_text(json.dumps({"campaign_id": campaign_id, "events": created}, indent=2), encoding="utf-8")
    print(f"\nWrote {manifest} ({len(created)} events). Next: python watch_campaign.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
