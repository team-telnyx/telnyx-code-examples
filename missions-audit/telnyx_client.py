"""Shared Telnyx client factory — used by every workflow script.

Extracted to satisfy DRY: previously `_client()` was duplicated verbatim
across create_mission.py, start_run.py, plan_steps.py, execute.py, and audit.py.
"""
from __future__ import annotations

import os
import re
import sys

import telnyx
from dotenv import load_dotenv

load_dotenv()

# E.164: leading '+', country code 1-9, then 1-14 more digits.
E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")


def client() -> telnyx.Telnyx:
    """Return an authenticated Telnyx client, or exit with an actionable error."""
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        sys.exit("TELNYX_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return telnyx.Telnyx(api_key=api_key)


def require_e164(value: str, var_name: str) -> str:
    """Validate a phone number is E.164, or exit with an actionable error.

    For ASSISTANT_PHONE_NUMBER the error message includes the portal step
    required to associate a number with the assistant (per Design Decision 4).
    """
    if not E164_RE.match(value or ""):
        hint = ""
        if var_name == "ASSISTANT_PHONE_NUMBER":
            hint = (
                " Associate a phone number with your assistant in the Telnyx "
                "Portal under AI -> Assistants -> Phone Numbers."
            )
        sys.exit(
            f"{var_name}={value!r} is not a valid E.164 phone number. "
            f"Expected format: +15551234567 (leading '+', country code, digits only). "
            f"Update {var_name} in .env.{hint}"
        )
    return value


def demo_mode() -> bool:
    """True unless DEMO_MODE is explicitly disabled."""
    return os.getenv("DEMO_MODE", "true").strip().lower() not in {"0", "false", "no"}


def unwrap(resp: object) -> object:
    """Return the payload from a Telnyx SDK response.

    The SDK wraps payloads in a response object. Depending on SDK version the
    payload is exposed as `.data`, `.body`, or the object is already a dict.
    Handle each explicitly so callers never silently receive the wrong shape.
    """
    if isinstance(resp, dict):
        return resp
    for attr in ("data", "body"):
        value = getattr(resp, attr, None)
        if value is not None:
            return value
    json_fn = getattr(resp, "json", None)
    if callable(json_fn):
        try:
            return json_fn()
        except Exception:  # noqa: BLE001 — fall through to returning the raw object
            pass
    return resp
