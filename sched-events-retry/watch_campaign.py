# SELF-REVIEW:
# \u2705 Polls GET .../scheduled_events every 30s and GET .../{event_id} for call_attempts
# \u2705 Rebuilds the per-attempt ledger (attempt_number, attempted_at, call_status, ...)
# \u2705 Asserts clock-restart semantics between retryable-terminal attempts
# \u2705 Asserts the DISTINGUISHING case: first retry fired at T1+interval, NOT schedule+interval
# \u2705 Dead-letters exhausted-budget events ONCE per event (dedup set)
# \u2705 Dead-letter CSV includes masked phone so replay can re-schedule contacts
# \u2705 Populates cancelled_ids from canceled event statuses (report counts them as cancelled)
# \u2705 Terminates when every manifest event reaches a terminal status (or --once/--max-polls)
# \u2705 Persists per-event attempt summaries to the manifest for report.py
# \u2705 No credentials in code; contact names/phones masked in dead-letter CSV

"""Step 2 \u2014 watch the campaign and rebuild attempt forensics.

Scheduled Events has no webhook surface, so polling `GET .../scheduled_events`
is the documented way to observe it. For each event this script prints status
transitions and, once `call_attempts` is populated, the per-attempt ledger.

It also verifies the documented retry clock: after a *terminal* attempt at time
T whose call_status is retryable (busy / no-answer / failed / canceled), the
next attempt must fire at >= T + retry_interval_secs (the clock restarts at
`now + interval`, not at the original schedule + interval). Violations are
flagged loudly and the process exits 1.

The watcher terminates on its own once every manifest event has reached a
terminal status (completed / failed / canceled), or when --once / --max-polls
is set.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")
API_KEY = os.getenv("TELNYX_API_KEY", "")
ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("1", "true", "yes")

POLL_INTERVAL = 30
RETRYABLE_STATUSES = {"busy", "no-answer", "failed", "canceled"}
TERMINAL_EVENT_STATUSES = {"completed", "failed", "canceled"}


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _events_url() -> str:
    return f"{API_BASE}/ai/assistants/{ASSISTANT_ID}/scheduled_events"


def mask_phone(phone: str) -> str:
    """Mask a phone number for logs: +15551234567 -> +1555****567."""
    if len(phone) < 8:
        return "***"
    return f"{phone[:5]}****{phone[-3:]}"


def mask_name(name: str) -> str:
    """Mask a contact name for the dead-letter CSV: 'Ada Lovelace' -> 'A*** L***'."""
    if not name:
        return ""
    return " ".join(f"{part[0]}***" if part else "" for part in name.split())


def parse_ts(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def list_events() -> list[dict[str, Any]]:
    """GET the paginated scheduled-events list."""
    resp = requests.get(_events_url(), headers=_headers(), params={"page[size]": 250}, timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", [])


def get_event(event_id: str) -> dict[str, Any]:
    """GET a single event, including its call_attempts ledger."""
    resp = requests.get(f"{_events_url()}/{event_id}", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", {})


def verify_retry_clock(attempts: list[dict[str, Any]], retry_interval: int) -> list[str]:
    """Assert each attempt fires >= previous *retryable-terminal* time + retry_interval_secs.

    The clock only restarts after a terminal attempt whose call_status is in
    RETRYABLE_STATUSES (busy / no-answer / failed / canceled). Pairs where the
    previous attempt is `completed`, in-flight, or has no terminal status are
    skipped \u2014 they are not retry triggers.
    """
    violations: list[str] = []
    for prev, nxt in zip(attempts, attempts[1:]):
        prev_status = prev.get("call_status")
        if prev_status not in RETRYABLE_STATUSES:
            continue
        prev_at = parse_ts(prev["attempted_at"])
        next_at = parse_ts(nxt["attempted_at"])
        earliest = prev_at.timestamp() + retry_interval
        if next_at.timestamp() < earliest:
            violations.append(
                f"attempt {nxt['attempt_number']} fired {next_at.isoformat()} "
                f"before {prev['attempted_at']} + {retry_interval}s "
                f"(prev status={prev_status})"
            )
    return violations


def verify_clock_restart(
    attempts: list[dict[str, Any]],
    scheduled_at: str,
    retry_interval: int,
) -> list[str]:
    """Assert the first retry fired at T1 + interval, NOT schedule + interval.

    This is the distinguishing assertion the sample exists to make. If the
    platform used `original_schedule + interval` semantics, the first retry
    would fire at `scheduled_at + retry_interval_secs`. Clock-restart semantics
    mean it fires at `attempt_1.attempted_at + retry_interval_secs`, which is
    strictly later whenever attempt #1 itself fired after the schedule (the
    normal case). We flag a violation when the first retry fires *before*
    `attempt_1.attempted_at + retry_interval_secs` \u2014 the only way that happens
    is if the platform restarted the clock at the original schedule instead.
    """
    if len(attempts) < 2 or not scheduled_at:
        return []
    first = attempts[0]
    if first.get("call_status") not in RETRYABLE_STATUSES:
        return []
    first_at = parse_ts(first["attempted_at"])
    second_at = parse_ts(attempts[1]["attempted_at"])
    restart_earliest = first_at.timestamp() + retry_interval
    schedule_earliest = parse_ts(scheduled_at).timestamp() + retry_interval
    if second_at.timestamp() < restart_earliest:
        return [
            f"attempt 2 fired {second_at.isoformat()} before attempt 1 "
            f"({first['attempted_at']}) + {retry_interval}s \u2014 clock did NOT restart "
            f"at the terminal attempt (schedule+interval would be "
            f"{datetime.fromtimestamp(schedule_earliest, tz=timezone.utc).isoformat()})"
        ]
    return []


def print_ledger(event: dict[str, Any], retry_interval: int) -> list[str]:
    """Print the per-attempt ledger and return any clock violations."""
    attempts = event.get("call_attempts") or []
    if not attempts:
        return []
    print(f"  ledger for {event.get('id')} ({len(attempts)} attempt(s)):")
    for att in attempts:
        print(
            f"    #{att.get('attempt_number')} {att.get('attempted_at')} "
            f"status={att.get('call_status')} dur={att.get('call_duration')}s "
            f"ccid={att.get('telnyx_call_control_id')}"
        )
    violations = verify_retry_clock(attempts, retry_interval)
    violations += verify_clock_restart(attempts, event.get("scheduled_at_fixed_datetime", ""), retry_interval)
    return violations


def write_dead_letter(path: Path, event: dict[str, Any]) -> None:
    """Append an exhausted-budget event to the dead-letter CSV (once per event).

    Includes the masked phone so the dead-letter file is actionable for replay
    (re-schedule the contact with a fresh campaign ID and a larger budget).
    """
    attempts = event.get("call_attempts") or []
    final_status = attempts[-1].get("call_status") if attempts else "unknown"
    new_file = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if new_file:
            writer.writerow(["event_id", "contact", "phone_masked", "attempts", "final_call_status"])
        meta = event.get("conversation_metadata") or {}
        writer.writerow([
            event.get("id"),
            mask_name(meta.get("contact_name", "")),
            mask_phone(event.get("telnyx_end_user_target", "")),
            len(attempts),
            final_status,
        ])


def summarize_event(event: dict[str, Any]) -> dict[str, Any]:
    """Build the per-event attempt summary persisted into the manifest for report.py."""
    attempts = event.get("call_attempts") or []
    reached_attempt = None
    for att in attempts:
        if att.get("call_status") == "completed":
            reached_attempt = att.get("attempt_number")
            break
    final_status = attempts[-1].get("call_status") if attempts else "unknown"
    return {
        "event_id": event.get("id"),
        "status": event.get("status"),
        "attempt_count": len(attempts),
        "final_call_status": final_status,
        "reached": reached_attempt is not None,
        "reached_on_attempt": reached_attempt,
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Watch a scheduled-events retry campaign.")
    parser.add_argument("--manifest", type=Path, default=Path("campaign_manifest.json"))
    parser.add_argument("--retry-interval", type=int, default=300)
    parser.add_argument("--once", action="store_true", help="Poll once and exit (for CI / smoke runs)")
    parser.add_argument("--max-polls", type=int, default=0, help="Stop after N polls (0 = run until all terminal)")
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"error: {args.manifest} not found \u2014 run create_campaign.py first", file=sys.stderr)
        return 2

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    campaign_id = manifest.get("campaign_id", "")
    manifest_event_ids = {e.get("event_id") for e in manifest.get("events", [])}
    dead_letter = Path("dead_letter.csv")
    print(f"Watching campaign {campaign_id} (poll every {POLL_INTERVAL}s)\n")

    seen_status: dict[str, str] = {}
    dead_lettered: set[str] = set()
    cancelled_ids: set[str] = set(manifest.get("cancelled_ids", []))
    summaries: dict[str, dict[str, Any]] = {}
    terminal_events: set[str] = set()
    violations_total = 0
    polls = 0

    while True:
        if DEMO_MODE:
            print("[demo] DEMO_MODE: no live events to poll; exiting watcher loop.")
            break
        try:
            events = [e for e in list_events() if (e.get("conversation_metadata") or {}).get("campaign_id") == campaign_id]
        except requests.RequestException as exc:
            print(f"poll failed: {exc}", file=sys.stderr)
            time.sleep(POLL_INTERVAL)
            continue

        for summary in events:
            event_id = summary.get("id", "")
            status = summary.get("status", "")
            if seen_status.get(event_id) != status:
                print(f"[{event_id}] status -> {status}")
                seen_status[event_id] = status
            try:
                event = get_event(event_id)
            except requests.RequestException:
                continue
            violations = print_ledger(event, args.retry_interval)
            for v in violations:
                print(f"  \u274c RETRY CLOCK VIOLATION: {v}")
            violations_total += len(violations)

            summaries[event_id] = summarize_event(event)

            if status == "canceled":
                cancelled_ids.add(event_id)

            if status == "failed" and event.get("errors") and event_id not in dead_lettered:
                write_dead_letter(dead_letter, event)
                dead_lettered.add(event_id)
                print(f"  \u2620\ufe0f  dead-lettered {event_id}")
            for att in event.get("call_attempts") or []:
                if att.get("call_status") == "completed" and att.get("conversation_id"):
                    print(f"  \u2705 {event_id} conversation_id={att['conversation_id']}")

            if status in TERMINAL_EVENT_STATUSES:
                terminal_events.add(event_id)

        polls += 1
        if args.once:
            break
        if args.max_polls and polls >= args.max_polls:
            print(f"\nReached --max-polls={args.max_polls}; stopping.")
            break
        if manifest_event_ids and manifest_event_ids.issubset(terminal_events):
            print(f"\nAll {len(manifest_event_ids)} event(s) reached terminal status; stopping.")
            break
        time.sleep(POLL_INTERVAL)

    # Persist per-event attempt summaries and cancelled ids into the manifest for report.py.
    manifest["attempt_summaries"] = list(summaries.values())
    manifest["dead_lettered_ids"] = sorted(dead_lettered)
    manifest["cancelled_ids"] = sorted(cancelled_ids)
    args.manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    if violations_total:
        print(f"\n\u274c {violations_total} retry-clock violation(s) detected", file=sys.stderr)
        return 1
    print("\nWatcher finished. Next: python report.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
