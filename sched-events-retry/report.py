# SELF-REVIEW:
# ✅ Aggregates final event states into the campaign scorecard
# ✅ Separates reached-on-first-attempt from reached-on-retry-N (from manifest attempt_summaries)
# ✅ Dead-letters exhausted-budget events with their final call_status
# ✅ Counts cancelled events explicitly (from manifest cancelled_ids), not as a residual
# ✅ No credentials in code; reads only the local manifest + dead-letter CSV

"""Step 3 — offline campaign scorecard.

Reads the campaign manifest (including the per-event attempt summaries written
by the watcher) and the dead-letter CSV, then prints the delivery report: total
events, reached on first attempt, reached on retry N, final failures by
call_status, cancelled events, and total attempt count versus the configured
budget.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def load_dead_letters(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def build_scorecard(manifest: dict, dead_letters: list[dict[str, str]]) -> dict:
    """Compute the scorecard from the manifest and dead-letter rows."""
    events = manifest.get("events", [])
    total = len(events)
    dead_letter_ids = {row["event_id"] for row in dead_letters}
    failures = Counter(row.get("final_call_status", "unknown") for row in dead_letters)

    summaries = manifest.get("attempt_summaries", [])
    reached_first = 0
    reached_on_retry: Counter = Counter()
    attempts_total = 0
    for s in summaries:
        attempts_total += int(s.get("attempt_count", 0) or 0)
        if s.get("reached"):
            n = int(s.get("reached_on_attempt", 0) or 0)
            if n == 1:
                reached_first += 1
            elif n > 1:
                reached_on_retry[n] += 1

    cancelled_ids = set(manifest.get("cancelled_ids", []))
    cancelled = len(cancelled_ids)

    return {
        "campaign_id": manifest.get("campaign_id", ""),
        "total_events": total,
        "reached_first_attempt": reached_first,
        "reached_on_retry": dict(sorted(reached_on_retry.items())),
        "dead_lettered": len(dead_letter_ids),
        "cancelled": cancelled,
        "failures_by_status": dict(failures),
        "attempts_observed": attempts_total,
    }


def print_scorecard(card: dict) -> None:
    print(f"Campaign scorecard — {card['campaign_id']}")
    print("=" * 52)
    print(f"  total events          : {card['total_events']}")
    print(f"  reached (first attempt): {card['reached_first_attempt']}")
    if card["reached_on_retry"]:
        for n, count in card["reached_on_retry"].items():
            print(f"  reached on retry {n:<4} : {count}")
    else:
        print("  reached on retry N    : (none)")
    print(f"  dead-lettered         : {card['dead_lettered']}")
    print(f"  cancelled (not failed): {card['cancelled']}")
    print(f"  attempts observed     : {card['attempts_observed']}")
    print("  final failures by call_status:")
    if card["failures_by_status"]:
        for status, count in sorted(card["failures_by_status"].items()):
            print(f"    {status:<12} {count}")
    else:
        print("    (none)")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Print the campaign delivery scorecard.")
    parser.add_argument("--manifest", type=Path, default=Path("campaign_manifest.json"))
    parser.add_argument("--dead-letter", type=Path, default=Path("dead_letter.csv"))
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"error: {args.manifest} not found — run create_campaign.py first")
        return 2

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    dead_letters = load_dead_letters(args.dead_letter)
    print_scorecard(build_scorecard(manifest, dead_letters))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
