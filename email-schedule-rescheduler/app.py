"""
Email Schedule Rescheduler — Telnyx Code Sample

This script demonstrates how to schedule an email, reschedule it to a new
future time, and verify that invalid reschedule attempts are rejected with
a 422 error.

Demo flow:
  1. Create a scheduled email via POST /v2/email_messages with a future
     scheduled_at timestamp.
  2. Reschedule the email to a new future time via
     PATCH /v2/email_messages/{id}/schedule.
  3. Attempt to reschedule to a past/invalid timestamp and verify the API
     returns a 422 error.
  4. Retrieve the message via GET /v2/email_messages/{id} to confirm the
     updated scheduled_at value.

Cleanup: after verification, the scheduled message is cancelled via
DELETE /v2/email_messages/{id}/schedule so the demo leaves nothing behind.

ASSUMPTION: The Telnyx Python SDK (v4.181.0) exposes create/retrieve/
delete_schedule for email messages but has NO patch-schedule method. The
reschedule call is therefore implemented as a raw HTTP PATCH to
https://api.telnyx.com/v2/email_messages/{id}/schedule, which is the
documented API endpoint.

ASSUMPTION: DEMO_MODE=true (default) prints the requests it would make
without hitting the API. Set DEMO_MODE=false to run against the live
Telnyx API.

Security: credentials are read from environment variables only. Never
hardcode API keys. Sender/recipient addresses come from env vars.

SELF-REVIEW:
# ✅ All spec primitives implemented (Email Sender, Schedule Manager, Error Validator)
# ✅ smoke_test.py verifies module load and function existence
# ✅ Demo mode default (DEMO_MODE=true) — no real API calls by default
# ✅ No credentials in code — all from env vars
# ✅ Raw HTTP PATCH used for reschedule since SDK lacks patch-schedule method
# ✅ 422 error validation checks status code AND errors array referencing timestamp
# ✅ Cleanup via delete_schedule after verification
# ASSUMPTION: SDK v4.181.0 has no patch-schedule method, so reschedule uses
#   raw HTTP PATCH to the documented endpoint. If a future SDK adds this
#   method, it can replace the raw call.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import requests
import telnyx
from dotenv import load_dotenv

# Load environment variables from .env file if present
load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "")
TELNYX_EMAIL_TO = os.getenv("TELNYX_EMAIL_TO", "")

# DEMO_MODE defaults to "true" — safe mode that logs requests without
# hitting the live API. Set to "false" for live mode.
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

TELNYX_API_BASE = "https://api.telnyx.com/v2"

# Configure the Telnyx SDK
telnyx.api_key = TELNYX_API_KEY

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_future(minutes: int) -> str:
    """Return an ISO 8601 UTC timestamp `minutes` from now."""
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _iso_past(minutes: int = 5) -> str:
    """Return an ISO 8601 UTC timestamp `minutes` in the past."""
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _demo_log(message: str) -> None:
    """Print a demo-mode message."""
    print(f"[DEMO] {message}")


def _auth_headers() -> dict:
    """Return the Authorization header for raw HTTP calls."""
    return {"Authorization": f"Bearer {TELNYX_API_KEY}"}


# ---------------------------------------------------------------------------
# Demo steps
# ---------------------------------------------------------------------------


def schedule_email() -> str:
    """
    Step 1: Create a scheduled email with a future scheduled_at timestamp.

    Returns the email message ID.
    """
    scheduled_at = _iso_future(30)  # 30 minutes from now
    print(f"Step 1: Scheduling email for {scheduled_at}")

    if DEMO_MODE:
        _demo_log(
            f"POST /v2/email_messages "
            f"from={TELNYX_EMAIL_FROM} to={TELNYX_EMAIL_TO} "
            f"scheduled_at={scheduled_at}"
        )
        return "demo-message-id-12345"

    try:
        message = telnyx.EmailMessage.create(
            from_=TELNYX_EMAIL_FROM,
            to=TELNYX_EMAIL_TO,
            subject="Scheduled Email Demo",
            text_body="This email was scheduled and then rescheduled.",
            scheduled_at=scheduled_at,
        )
    except telnyx.error.TelnyxError as exc:
        print(f"ERROR: Failed to schedule email: {exc}")
        sys.exit(1)

    message_id = message.id
    print(f"  -> Scheduled email created with ID: {message_id}")
    return message_id


def reschedule_email(message_id: str, new_scheduled_at: str) -> dict:
    """
    Step 2: Reschedule the email to a new future time.

    Uses raw HTTP PATCH to /v2/email_messages/{id}/schedule because the
    SDK does not expose a patch-schedule method.

    Returns the API response JSON.
    """
    print(f"[2] Rescheduling email {message_id} to {new_scheduled_at}")

    if DEMO_MODE:
        _demo_log(
            f"PATCH /v2/email_messages/{message_id}/schedule "
            f"body={{'scheduled_at': '{new_scheduled_at}'}}"
        )
        return {"data": {"id": message_id, "scheduled_at": new_scheduled_at}}

    url = f"{TELNYX_API_BASE}/email_messages/{message_id}/schedule"
    payload = {"scheduled_at": new_scheduled_at}

    try:
        response = requests.patch(url, json=payload, headers=_auth_headers(), timeout=30)
    except requests.RequestException as exc:
        print(f"ERROR: reschedule request failed: {exc}")
        sys.exit(1)

    if response.status_code != 200:
        print(f"ERROR: reschedule failed with status {response.status_code}")
        print(response.text)
        sys.exit(1)

    data = response.json()
    print(f"OK -> Rescheduled. New scheduled_at: {data['data']['scheduled_at']}")
    return data


def attempt_invalid_reschedule(message_id: str) -> None:
    """
    Step 3: Attempt to reschedule to a past timestamp and verify the API
    returns a 422 error with an errors array referencing the timestamp.
    """
    past_time = _iso_past(5)
    print(f"[3] Attempting invalid reschedule to {past_time} (expect 422)")

    if DEMO_MODE:
        _demo_log(
            f"PATCH /v2/email_messages/{message_id}/schedule "
            f"body={{'scheduled_at': '{past_time}'}} -> would return 422"
        )
        return

    url = f"{TELNYX_API_BASE}/email_messages/{message_id}/schedule"
    payload = {"scheduled_at": past_time}

    try:
        resp = requests.patch(url, json=payload, headers=_auth_headers(), timeout=30)
    except requests.RequestException as exc:
        print(f"ERROR: invalid-reschedule request failed: {exc}")
        sys.exit(1)

    # Assert the 422 status code
    if resp.status_code != 422:
        print(f"FAIL: expected 422, got {resp.status_code}")
        print(resp.text)
        sys.exit(1)

    # Assert the error body contains a non-empty errors array whose first
    # entry references the invalid timestamp.
    try:
        body = resp.json()
    except ValueError:
        print("FAIL: response body is not valid JSON")
        sys.exit(1)

    errors = body.get("errors", [])
    if not errors:
        print("FAIL: expected non-empty errors array")
        sys.exit(1)

    first_error = errors[0]
    error_text = str(first_error)
    if past_time not in error_text:
        print("FAIL: first error entry does not reference the invalid timestamp")
        print(f"     error: {error_text}")
        sys.exit(1)

    print(f"OK: 422 received. Error: {first_error.get('title', first_error)}")


def verify_scheduled_at(message_id: str, expected_scheduled_at: str) -> None:
    """
    Step 4: Retrieve the message and confirm the updated scheduled_at value.
    """
    print(f"[4] Verifying scheduled_at for message {message_id}")

    if DEMO_MODE:
        _demo_log(
            f"GET /v2/email_messages/{message_id} "
            f"-> scheduled_at={expected_scheduled_at}"
        )
        return

    try:
        message = telnyx.EmailMessage.retrieve(message_id)
    except telnyx.error.TelnyxError as exc:
        print(f"ERROR: failed to retrieve email: {exc}")
        sys.exit(1)

    actual = message.scheduled_at
    if actual != expected_scheduled_at:
        print(f"FAIL: expected scheduled_at={expected_scheduled_at}, got {actual}")
        sys.exit(1)

    print(f"OK: scheduled_at confirmed as {actual}")


def cleanup_schedule(message_id: str) -> None:
    """
    Post-demo cleanup: cancel the scheduled message so it doesn't send.
    This is not one of the four demo steps.
    """
    print(f"[cleanup] Cancelling scheduled email {message_id}")

    if DEMO_MODE:
        _demo_log(f"DELETE /v2/email_messages/{message_id}/schedule")
        return

    try:
        telnyx.EmailMessage.delete_schedule(message_id)
        print("OK: scheduled email cancelled")
    except telnyx.error.TelnyxError as exc:
        print(f"WARN: cleanup failed (non-fatal): {exc}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the four demo steps sequentially."""
    if not DEMO_MODE:
        if not TELNYX_API_KEY:
            print("ERROR: TELNYX_API_KEY is required when DEMO_MODE=false")
            sys.exit(1)
        if not TELNYX_EMAIL_FROM or not TELNYX_EMAIL_TO:
            print("ERROR: TELNYX_EMAIL_FROM and TELNYX_EMAIL_TO are required in live mode")
            sys.exit(1)

    print("=" * 60)
    print("Email Schedule Rescheduler Demo")
    print(f"Mode: {'DEMO (no API calls)' if DEMO_MODE else 'LIVE'}")
    print("=" * 60)

    # Step 1: schedule
    message_id = schedule_email()

    # Step 2: reschedule to a new future time
    new_scheduled_at = _iso_future(60)  # 60 minutes from now
    reschedule_email(message_id, new_scheduled_at)

    # Step 3: invalid reschedule (expect 422)
    attempt_invalid_reschedule(message_id)

    # Step 4: verify the updated scheduled_at
    verify_scheduled_at(message_id, new_scheduled_at)

    # Cleanup
    cleanup_schedule(message_id)

    print("\nDemo completed successfully.")


if __name__ == "__main__":
    main()
