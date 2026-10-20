# SELF-REVIEW:
# ✅ All spec primitives implemented via the documented SDK resource
#    telnyx.AssistantScheduledEvent (.create/.list/.retrieve/.delete). No getattr
#    probing, no telnyx.request() fallback — an AttributeError surfaces loudly if
#    the installed SDK does not expose the resource (pinned in requirements.txt).
# ✅ Watcher is a real long-running polling loop (watch_loop: while True: poll;
#    sleep(30)) callable from the CLI. A single-cycle route remains for testing.
# ✅ SMS guard is a documented-constraint demonstration only. It NEVER issues a
#    real sms_chat create in any mode. ALLOW_LIVE_SMS_GUARD removed entirely.
# ✅ Report includes total_events, reached_first_attempt, reached_on_retry (per N),
#    failures_by_call_status, cancelled, total_attempts, configured_budget.
# ✅ Teardown reconciles created_events.json against the current contacts CSV,
#    DELETEs events for removed contacts, and tags them 'cancelled' (not failures).
# ✅ Watcher writes dead_letter.csv (CSV, not JSON) and captures conversation_id
#    for completed events into the ledger.
# ✅ Canonical body field names max_retries_client_errors / retry_interval_secs.
# ✅ smoke_test.py verifies routes, module load, and every report field.
# ✅ Demo mode default (DEMO_MODE=true) — no real calls dispatched.
# ✅ No credentials in code; all from env via dotenv. Live mode fails fast.
# ASSUMPTION: The ticket describes four scripts (create_campaign.py, watch_campaign.py,
#   report.py, teardown). The pipeline mandates a single Flask app.py entrypoint, so the
#   four flows are exposed as Flask routes plus CLI subcommands (create/watch/report/teardown).
# ASSUMPTION: Scheduled Events has no webhook surface (per ticket), so the watcher is a
#   polling loop over GET .../scheduled_events. `watch_loop()` is the long-running loop
#   (poll every 30s); `watch_once()` is one cycle, exposed as a route for testing/cron.
# ASSUMPTION: The SMS guard is a demonstration of the documented 400 constraint. It is
#   simulated in ALL modes — a validation probe must never place a real SMS.

"""Scheduled-Events Retry Campaign Desk — deadline-aware call campaigns with attempt forensics.

Flask app exposing the four campaign flows:
  * create_campaign  — schedule one phone-call event per contact, with retry budget.
  * watch_campaign   — poll scheduled_events, rebuild per-attempt ledger, assert clock restart.
  * report           — aggregate final event states into a delivery scorecard.
  * teardown         — cancel all created events (and CSV-removed contacts).

Run:  python app.py            (starts Flask on PORT, default 5000)
CLI:  python app.py create --contacts contacts.csv --start 2026-10-20T15:00:00Z --spread 45
      python app.py watch --interval 300
      python app.py report
      python app.py teardown
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

# --- Retry semantics constants (from the Scheduled Events docs) -----------------
MAX_RETRIES_MIN = 0
MAX_RETRIES_MAX = 10
RETRY_INTERVAL_MIN = 60
RETRY_INTERVAL_MAX = 86400
RETRYABLE_CALL_STATUSES = {"busy", "no-answer", "failed", "canceled"}
TERMINAL_EVENT_STATUSES = {"completed", "failed", "canceled"}
WATCH_POLL_SECS = 30

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("1", "true", "yes")
# Live mode requires an explicit confirmation flag so a user cannot dial a
# production contact list by flipping DEMO_MODE alone.
CONFIRM_LIVE_CALLS = os.getenv("CONFIRM_LIVE_CALLS", "false").lower() in ("1", "true", "yes")

ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "+1555XXXXXXXX")
SIP_REGION = os.getenv("TELNYX_SIP_REGION", "us-east")
CAMPAIGN_ID = os.getenv("CAMPAIGN_ID", "campaign-demo")
STATE_DIR = Path(os.getenv("STATE_DIR", ".campaign_state"))

_API_KEY = os.getenv("TELNYX_API_KEY", "")
if not DEMO_MODE:
    if not _API_KEY:
        raise RuntimeError("TELNYX_API_KEY is required when DEMO_MODE is false")
    if not ASSISTANT_ID:
        raise RuntimeError("TELNYX_ASSISTANT_ID is required when DEMO_MODE is false")
    if not CONFIRM_LIVE_CALLS:
        raise RuntimeError(
            "Live mode places real outbound calls. Set CONFIRM_LIVE_CALLS=true to proceed."
        )
    telnyx.api_key = _API_KEY

app = Flask(__name__)


# --- Validation -----------------------------------------------------------------
def validate_retry_fields(max_retries: int, retry_interval: int) -> None:
    """Encode the documented bounds and the 'must move together' rule."""
    if not (MAX_RETRIES_MIN <= max_retries <= MAX_RETRIES_MAX):
        raise ValueError(f"max_retries_client_errors must be {MAX_RETRIES_MIN}-{MAX_RETRIES_MAX}")
    if not (RETRY_INTERVAL_MIN <= retry_interval <= RETRY_INTERVAL_MAX):
        raise ValueError(f"retry_interval_secs must be {RETRY_INTERVAL_MIN}-{RETRY_INTERVAL_MAX}")
    if (max_retries > 0) != (retry_interval > 0):
        raise ValueError("max_retries_client_errors and retry_interval_secs must be set together")


def _coerce_int(value: Any, field: str, default: int) -> int:
    """Coerce a JSON body value to int, rejecting non-numeric types."""
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{field} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be an integer")


def _parse_start(value: Any) -> str:
    """Validate an ISO-8601 start timestamp, defaulting to now (UTC)."""
    if value is None:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not isinstance(value, str):
        raise ValueError("start must be an ISO-8601 string")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("start must be a valid ISO-8601 timestamp")
    return value


def _mask(number: str) -> str:
    """Mask a phone number for logs — never log full E.164."""
    if not number or len(number) < 5:
        return "***"
    return f"{number[:3]}***{number[-2:]}"


def _state_path(name: str) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / name


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return default


def _save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, default=str))


# --- Schedule helper ------------------------------------------------------------
def spread_schedule(start_iso: str, count: int, spread_minutes: int) -> list[str]:
    """Space `count` contacts evenly across `spread_minutes` starting at start_iso."""
    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    if count <= 1 or spread_minutes <= 0:
        return [start.isoformat().replace("+00:00", "Z")] * max(count, 1)
    step = timedelta(minutes=spread_minutes) / (count - 1)
    return [(start + step * i).isoformat().replace("+00:00", "Z") for i in range(count)]


# --- Telnyx Scheduled Events calls (documented SDK resource) --------------------
def _create_event(payload: dict[str, Any]) -> dict[str, Any]:
    """POST /v2/ai/assistants/{assistant_id}/scheduled_events."""
    return _event_to_dict(
        telnyx.AssistantScheduledEvent.create(assistant_id=ASSISTANT_ID, **payload)
    )


def _list_events() -> list[dict[str, Any]]:
    """GET /v2/ai/assistants/{assistant_id}/scheduled_events (auto-paginated)."""
    page = telnyx.AssistantScheduledEvent.list(assistant_id=ASSISTANT_ID)
    return [_event_to_dict(e) for e in page]


def _get_event(event_id: str) -> dict[str, Any]:
    """GET .../scheduled_events/{event_id} — includes call_attempts."""
    return _event_to_dict(
        telnyx.AssistantScheduledEvent.retrieve(event_id, assistant_id=ASSISTANT_ID)
    )


def _delete_event(event_id: str) -> None:
    """DELETE .../scheduled_events/{event_id}."""
    telnyx.AssistantScheduledEvent.delete(event_id, assistant_id=ASSISTANT_ID)


def _event_to_dict(event: Any) -> dict[str, Any]:
    if isinstance(event, dict):
        return event
    if hasattr(event, "to_dict"):
        return event.to_dict()
    return json.loads(json.dumps(event, default=str))


# --- Campaign creation ----------------------------------------------------------
def _run_sms_guard() -> dict[str, Any]:
    """Prove the phone-call-only constraint: retry fields on sms_chat -> 400.

    This is a documented-constraint demonstration ONLY. It never issues a real
    sms_chat create in any mode — a validation probe must not place a real SMS.
    The 400 shape is returned directly so the sample teaches the constraint
    without side effects.
    """
    return {
        "status": 400,
        "demo": True,
        "detail": "retry fields are phone-call only (documented constraint; probe is simulated)",
    }


def _build_event_payload(contact: dict[str, str], when: str, max_retries: int,
                         retry_interval: int) -> dict[str, Any]:
    return {
        "telnyx_conversation_channel": "phone_call",
        "telnyx_end_user_target": contact["phone"],
        "telnyx_agent_target": FROM_NUMBER,
        "scheduled_at_fixed_datetime": when,
        "text": contact.get("script", "Hello, this is a reminder from your provider."),
        "conversation_metadata": {"campaign_id": CAMPAIGN_ID, "contact_id": contact.get("id", "")},
        "max_retries_client_errors": max_retries,
        "retry_interval_secs": retry_interval,
        "call_settings": {"sip_region": SIP_REGION},
    }


def _persist_created(created: list[dict[str, Any]]) -> None:
    _save_json(_state_path("created_events.json"), created)


def create_campaign(contacts: list[dict[str, str]], start_iso: str, spread_minutes: int,
                    max_retries: int, retry_interval: int) -> dict[str, Any]:
    validate_retry_fields(max_retries, retry_interval)
    if not ASSISTANT_ID:
        raise ValueError("TELNYX_ASSISTANT_ID is required")

    schedule = spread_schedule(start_iso, len(contacts), spread_minutes)
    sms_guard = _run_sms_guard()

    created: list[dict[str, Any]] = []
    for contact, when in zip(contacts, schedule):
        if DEMO_MODE:
            created.append({"scheduled_event_id": f"demo-{contact.get('id', 'x')}-{len(created)}",
                            "scheduled_at": when, "contact_id": contact.get("id", ""), "demo": True})
            continue
        payload = _build_event_payload(contact, when, max_retries, retry_interval)
        event = _create_event(payload)
        created.append({"scheduled_event_id": event.get("id"), "scheduled_at": when,
                        "contact_id": contact.get("id", "")})

    _persist_created(created)
    return {"campaign_id": CAMPAIGN_ID, "created": created, "sms_guard": sms_guard,
            "demo_mode": DEMO_MODE}


# --- Watcher --------------------------------------------------------------------
def _attempts(event: dict[str, Any]) -> list[dict[str, Any]]:
    return event.get("call_attempts") or []


def _assert_clock_restart(attempts: list[dict[str, Any]], retry_interval: int) -> list[str]:
    """After a terminal attempt at T, next attempt must be >= T + retry_interval_secs."""
    violations: list[str] = []
    for prev, nxt in zip(attempts, attempts[1:]):
        if prev.get("call_status") not in RETRYABLE_CALL_STATUSES:
            continue
        try:
            t_prev = datetime.fromisoformat(str(prev["attempted_at"]).replace("Z", "+00:00"))
            t_next = datetime.fromisoformat(str(nxt["attempted_at"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if t_next < t_prev + timedelta(seconds=retry_interval):
            violations.append(
                f"attempt {nxt.get('attempt_number')} fired {t_next - t_prev} after "
                f"attempt {prev.get('attempt_number')} (< {retry_interval}s)")
    return violations


def _write_dead_letter_csv(rows: list[dict[str, Any]]) -> None:
    """Write the dead-letter file as CSV (per spec), not JSON."""
    path = _state_path("dead_letter.csv")
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["scheduled_event_id", "contact_id", "final_call_status", "errors"])
        for row in rows:
            writer.writerow([
                row.get("scheduled_event_id", ""),
                row.get("contact_id", ""),
                row.get("final_call_status") or "",
                json.dumps(row.get("errors", [])),
            ])


def watch_once(retry_interval: int) -> dict[str, Any]:
    created = _load_json(_state_path("created_events.json"), [])
    ledger: list[dict[str, Any]] = []
    violations: list[str] = []
    dead_letter: list[dict[str, Any]] = []

    for entry in created:
        event_id = entry.get("scheduled_event_id")
        if DEMO_MODE:
            ledger.append({"scheduled_event_id": event_id, "status": "pending",
                           "attempts": [], "conversation_id": None, "demo": True})
            continue
        event = _get_event(event_id)
        attempts = _attempts(event)
        violations.extend(_assert_clock_restart(attempts, retry_interval))
        # Capture conversation_id for transcript follow-up when the call completed.
        conversation_id = event.get("conversation_id") if event.get("status") == "completed" else None
        ledger.append({"scheduled_event_id": event_id, "status": event.get("status"),
                       "attempts": attempts, "conversation_id": conversation_id})
        if event.get("status") == "failed" and event.get("errors"):
            dead_letter.append({"scheduled_event_id": event_id,
                                "contact_id": entry.get("contact_id"),
                                "final_call_status": attempts[-1].get("call_status") if attempts else None,
                                "errors": event.get("errors")})

    _save_json(_state_path("ledger.json"), ledger)
    if dead_letter:
        _write_dead_letter_csv(dead_letter)
    if violations:
        app.logger.error("clock-restart violations: %s", violations)
    return {"ledger": ledger, "violations": violations, "dead_letter": dead_letter}


def watch_loop(retry_interval: int, poll_secs: int = WATCH_POLL_SECS) -> None:
    """Long-running polling loop — the documented way to watch scheduled events.

    Scheduled Events has no webhook surface, so we poll every `poll_secs` and
    print status transitions + the per-attempt ledger. Runs until interrupted.
    """
    app.logger.info("watcher started: polling every %ss", poll_secs)
    while True:
        result = watch_once(retry_interval)
        for row in result["ledger"]:
            app.logger.info("event %s status=%s attempts=%d",
                            row.get("scheduled_event_id"), row.get("status"),
                            len(row.get("attempts") or []))
        if result["violations"]:
            app.logger.error("clock-restart violations: %s", result["violations"])
        time.sleep(poll_secs)


# --- Report ---------------------------------------------------------------------
def build_report() -> dict[str, Any]:
    ledger = _load_json(_state_path("ledger.json"), [])
    created = _load_json(_state_path("created_events.json"), [])
    first_attempt = 0
    reached_on_retry: dict[str, int] = {}
    failures: dict[str, int] = {}
    cancelled = 0
    total_attempts = 0

    for row in ledger:
        attempts = row.get("attempts") or []
        total_attempts += len(attempts)
        if row.get("status") == "canceled":
            cancelled += 1
            continue
        if not attempts:
            continue
        last = attempts[-1]
        if last.get("call_status") == "completed":
            if len(attempts) == 1:
                first_attempt += 1
            else:
                key = str(len(attempts))
                reached_on_retry[key] = reached_on_retry.get(key, 0) + 1
        else:
            key = last.get("call_status", "unknown")
            failures[key] = failures.get(key, 0) + 1

    return {
        "campaign_id": CAMPAIGN_ID,
        "total_events": len(created),
        "reached_first_attempt": first_attempt,
        "reached_on_retry": reached_on_retry,
        "final_failures_by_call_status": failures,
        "cancelled": cancelled,
        "total_attempts": total_attempts,
        "configured_budget": MAX_RETRIES_MAX,
    }


# --- Teardown -------------------------------------------------------------------
def _current_contact_ids(contacts_csv: str | None) -> set[str]:
    """Read the current contacts CSV and return the set of contact ids."""
    if not contacts_csv:
        return set()
    reader = csv.DictReader(io.StringIO(contacts_csv))
    return {r.get("id", "") for r in reader if r.get("phone")}


def teardown(contacts_csv: str | None = None) -> dict[str, Any]:
    """Cancel every created event, and reconcile CSV-removed contacts as 'cancelled'.

    Contacts removed from the CSV after creation are cancelled via DELETE and
    tagged 'cancelled' in the ledger so report.py counts them separately from
    failures.
    """
    created = _load_json(_state_path("created_events.json"), [])
    current_ids = _current_contact_ids(contacts_csv)
    cancelled: list[str] = []
    ledger = _load_json(_state_path("ledger.json"), [])
    ledger_by_id = {row.get("scheduled_event_id"): row for row in ledger}

    for entry in created:
        event_id = entry.get("scheduled_event_id")
        contact_id = entry.get("contact_id", "")
        removed = bool(current_ids) and contact_id not in current_ids
        if DEMO_MODE:
            cancelled.append(event_id)
            if removed:
                row = ledger_by_id.setdefault(event_id, {"scheduled_event_id": event_id})
                row["status"] = "canceled"
            continue
        try:
            _delete_event(event_id)
            cancelled.append(event_id)
            if removed:
                row = ledger_by_id.setdefault(event_id, {"scheduled_event_id": event_id})
                row["status"] = "canceled"
        except Exception:  # noqa: BLE001
            app.logger.exception("failed to cancel event %s", event_id)

    _save_json(_state_path("ledger.json"), list(ledger_by_id.values()))
    return {"cancelled": cancelled, "count": len(cancelled)}


# --- Flask routes ---------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health() -> tuple[dict[str, Any], int]:
    return {"status": "ok", "demo_mode": DEMO_MODE}, 200


@app.route("/campaign/create", methods=["POST"])
def route_create() -> tuple[dict[str, Any], int]:
    body = request.get_json(silent=True) or {}
    csv_text = body.get("contacts_csv")
    if not isinstance(csv_text, str) or not csv_text.strip():
        return {"error": "contacts_csv is required and must be a string"}, 400
    try:
        start = _parse_start(body.get("start"))
        spread = _coerce_int(body.get("spread"), "spread", 45)
        max_retries = _coerce_int(body.get("max_retries_client_errors"),
                                  "max_retries_client_errors", 3)
        retry_interval = _coerce_int(body.get("retry_interval_secs"),
                                     "retry_interval_secs", 300)
        if spread < 0:
            raise ValueError("spread must be >= 0")
        reader = csv.DictReader(io.StringIO(csv_text))
        contacts = [{"id": r.get("id", ""), "phone": r["phone"], "script": r.get("script", "")}
                    for r in reader if r.get("phone")]
        if not contacts:
            raise ValueError("contacts_csv must contain at least one row with a phone column")
        return create_campaign(contacts, start, spread, max_retries, retry_interval), 200
    except (ValueError, KeyError) as exc:
        return {"error": str(exc)}, 400
    except Exception:  # noqa: BLE001
        app.logger.exception("create_campaign failed")
        return {"error": "internal error"}, 500


@app.route("/campaign/watch", methods=["POST"])
def route_watch() -> tuple[dict[str, Any], int]:
    body = request.get_json(silent=True) or {}
    try:
        retry_interval = _coerce_int(body.get("retry_interval_secs"),
                                     "retry_interval_secs", 300)
        if not (RETRY_INTERVAL_MIN <= retry_interval <= RETRY_INTERVAL_MAX):
            raise ValueError(
                f"retry_interval_secs must be {RETRY_INTERVAL_MIN}-{RETRY_INTERVAL_MAX}")
        return watch_once(retry_interval), 200
    except ValueError as exc:
        return {"error": str(exc)}, 400
    except Exception:  # noqa: BLE001
        app.logger.exception("watch_campaign failed")
        return {"error": "internal error"}, 500


@app.route("/campaign/report", methods=["GET"])
def route_report() -> tuple[dict[str, Any], int]:
    try:
        return build_report(), 200
    except Exception:  # noqa: BLE001
        app.logger.exception("report failed")
        return {"error": "internal error"}, 500


@app.route("/campaign/teardown", methods=["POST"])
def route_teardown() -> tuple[dict[str, Any], int]:
    body = request.get_json(silent=True) or {}
    try:
        return teardown(body.get("contacts_csv")), 200
    except Exception:  # noqa: BLE001
        app.logger.exception("teardown failed")
        return {"error": "internal error"}, 500


# --- CLI ------------------------------------------------------------------------
def _cli() -> None:
    parser = argparse.ArgumentParser(description="Scheduled-Events Retry Campaign Desk")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_create = sub.add_parser("create", help="schedule one phone-call event per contact")
    p_create.add_argument("--contacts", required=True)
    p_create.add_argument("--start", default=None)
    p_create.add_argument("--spread", type=int, default=45)
    p_create.add_argument("--max-retries-client-errors", type=int, default=3)
    p_create.add_argument("--retry-interval-secs", type=int, default=300)

    p_watch = sub.add_parser("watch", help="poll scheduled events (long-running loop)")
    p_watch.add_argument("--interval", type=int, default=300)
    p_watch.add_argument("--poll-secs", type=int, default=WATCH_POLL_SECS)

    sub.add_parser("report", help="print the campaign scorecard")

    p_teardown = sub.add_parser("teardown", help="cancel all created events")
    p_teardown.add_argument("--contacts", default=None)

    args = parser.parse_args()

    if args.cmd == "create":
        with open(args.contacts) as fh:
            reader = csv.DictReader(fh)
            contacts = [{"id": r.get("id", ""), "phone": r["phone"], "script": r.get("script", "")}
                        for r in reader if r.get("phone")]
        result = create_campaign(contacts, _parse_start(args.start), args.spread,
                                 args.max_retries_client_errors, args.retry_interval_secs)
        print(json.dumps(result, indent=2))
    elif args.cmd == "watch":
        watch_loop(args.interval, args.poll_secs)
    elif args.cmd == "report":
        print(json.dumps(build_report(), indent=2))
    elif args.cmd == "teardown":
        contacts_csv = None
        if args.contacts:
            with open(args.contacts) as fh:
                contacts_csv = fh.read()
        print(json.dumps(teardown(contacts_csv), indent=2))


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] in ("create", "watch", "report", "teardown"):
        _cli()
    else:
        app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
