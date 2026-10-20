#!/usr/bin/env python3
"""Step 3 — ledger.py: read GET /spend/events and close the failover proof.

The ledger records the same story the response headers told: each event row
carries `requested_model` (what the caller asked for) next to `model` (the
public alias that actually served), plus `attempts`, `status`, and
`cache_hit`. When the two model fields differ, that row is the gateway's
record of a fallback — the durable, auditable counterpart of
x-ltg-served-model on the live path.

The report is a half-open UTC date range [start_date, end_date) filtered by
token_key_id, snapshot-paginated (page_snapshot is required after page 1).
Set START_DATE / END_DATE to replay on another day.

Finally the script calls GET /usage/summary (the combined group dashboard:
data.totals, data.by_day, data.by_model, guardrail counts). That endpoint
needs the dedicated llm_token_gateway.usage.read permission; if the call is
denied (403) the warning is documented and non-fatal — the spend-events table
above remains the canonical demo output.
"""

from __future__ import annotations

from typing import Any

from gateway import (
    FALLBACK_MODEL,
    PRIMARY_MODEL,
    load_state,
    mgmt_client,
    spend_date_range,
)


def fetch_events(client: Any, token_key_id: str, start_date: str, end_date: str,
                 max_pages: int = 3) -> list[Any]:
    """Snapshot-paginated read of the spend ledger."""
    events: list[Any] = []
    page_number = 1
    page_snapshot: str | None = None
    for _ in range(max_pages):
        response = client.llm_token_gateway.spend.retrieve_events(
            start_date=start_date,
            end_date=end_date,
            token_key_id=token_key_id,
            page_number=page_number,
            page_size=50,
            page_snapshot=page_snapshot,
        )
        events.extend(response.data)
        if not response.meta.has_more:
            return events
        page_snapshot = response.meta.snapshot
        page_number += 1
    return events


def print_rows(events: list[Any]) -> list[Any]:
    """Print one row per request; return the rows where a fallback served."""
    if not events:
        print("No spend events in the range — run inference.py first, or widen "
              "START_DATE/END_DATE.")
        return []
    print(f"  {'requested_model':<16} {'served (model)':<16} {'att':>3} {'status':<10} "
          f"{'cache':<5} {'cost'}")
    fallback_rows: list[Any] = []
    for event in events:
        cost = f"${event.cost:.6f}" if event.cost is not None else "-"
        print(f"  {event.requested_model:<16} {event.model:<16} {event.attempts:>3} "
              f"{event.status:<10} {str(event.cache_hit):<5} {cost}")
        if event.requested_model != event.model:
            fallback_rows.append(event)
    return fallback_rows


def usage_summary_safe(client: Any, token_group_id: str, start_date: str, end_date: str):
    """Return (summary, warning). A 403 (missing llm_token_gateway.usage.read
    permission) is a documented, non-fatal warning; anything else propagates."""
    try:
        summary = client.llm_token_gateway.usage.retrieve_summary(
            start_date=start_date,
            end_date=end_date,
            token_group_id=token_group_id,
        )
        return summary, None
    except Exception as exc:  # noqa: BLE001 - 403 is expected on narrower accounts
        if getattr(exc, "status_code", None) == 403:
            return None, (
                "GET /usage/summary needs the dedicated llm_token_gateway.usage.read "
                "permission — the spend-events table remains the canonical demo output."
            )
        raise


def main() -> int:
    state = load_state()
    client = mgmt_client()
    start_date, end_date = spend_date_range()
    print(f"Spend events for token_key_id={state['key_id']} over [{start_date}, {end_date}):")
    events = fetch_events(client, state["key_id"], start_date, end_date)
    print()
    fallback_rows = print_rows(events)
    print()
    if fallback_rows:
        for event in fallback_rows:
            print(f"FAILOVER PROOF IN LEDGER: requested_model={event.requested_model} "
                  f"but model={event.model} served in {event.attempts} attempt(s) "
                  f"(request_id={event.request_id}) — the ledger records the same "
                  f"failover the headers showed.")
    else:
        print(f"No fallback served yet — events show {PRIMARY_MODEL} serving directly. "
              f"Run inference.py until a forced-failure trip lands in this window "
              f"(expected fallback: {FALLBACK_MODEL}).")

    print()
    print("Usage summary (GET /usage/summary):")
    summary, warning = usage_summary_safe(client, state["group_id"], start_date, end_date)
    if summary is not None:
        totals = summary.data.totals
        print(f"  totals: requests={totals.requests} input_tokens={totals.input_tokens} "
              f"output_tokens={totals.output_tokens} cache_hits={totals.cache_hits} "
              f"failed_requests={totals.failed_requests} reserved_spend={totals.reserved_spend}")
        for by_model in summary.data.by_model[:5]:
            print(f"  by_model: {by_model.model} requests={by_model.requests} "
                  f"cache_hits={by_model.cache_hits} failed={by_model.failed_requests}")
    else:
        print(f"  WARNING (non-fatal): {warning}")
    print()
    print("Next: python policy.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
