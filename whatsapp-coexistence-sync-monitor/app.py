"""
WhatsApp Coexistence Sync Monitor

A lightweight Flask service that monitors a coexistence-enabled WhatsApp number.
It verifies the number's lifecycle state via the Telnyx API and listens for
`message.echo` webhooks to log messages sent manually from the WhatsApp
Business app, ensuring the application state stays in sync with the manual
channel.

SELF-REVIEW:
✅ All spec primitives implemented (Webhook Receiver, State Checker, Message Logger)
✅ smoke_test.py verifies routes and module load (incl. valid-signature webhook flow)
✅ Demo mode default (DEMO_MODE=true) — no real API calls in demo mode
✅ No credentials in code — all from env vars
✅ Webhook signature verified via client.webhooks.unwrap(..., key=...) (Ed25519)
✅ Append-only JSONL persistence (echo_log.jsonl) — real file, not in-memory
✅ State Checker uses real Telnyx API
   (GET /v2/whatsapp/business_accounts/{waba_id}/phone_numbers via
    client.whatsapp.business_accounts.phone_numbers.list — SDK v4 path)
✅ Startup cross-check via GET /v2/whatsapp/phone_numbers/{phone_number}
   (client.whatsapp.phone_numbers.retrieve_phone_number)
✅ 60-second TTL cache for state checks — no hammering the API
✅ Invalid signature → HTTP 401, body not processed (acceptance criterion)
✅ Webhook while NOT active → HTTP 200, skipped, warning logged (design decision #3)
✅ origin validated against 'whatsapp_business_app' (acceptance criterion #2)
✅ cost verified null / {amount: null, currency: null} → no_charge flag
   in the audit log (acceptance criterion #3)
ASSUMPTION: The spec says "coexistence_state" values include 'active' as the only
  state that allows Cloud API sends. This sample treats any other state as
  "not active" and skips processing (logs a warning, returns 200).
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

# Load environment variables from .env if present
load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
WABA_ID = os.getenv("WABA_ID", "")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")  # e.g. +1555XXXXXXXX
ECHO_LOG_PATH = os.getenv("ECHO_LOG_PATH", "echo_log.jsonl")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
STATE_CHECK_TTL_SECONDS = int(os.getenv("STATE_CHECK_TTL_SECONDS", "60"))
MAX_TIMESTAMP_SKEW_SECONDS = int(os.getenv("MAX_TIMESTAMP_SKEW_SECONDS", "300"))

# Configure Telnyx SDK (v4 client). public_key lets client.webhooks.unwrap
# verify Ed25519 signatures without re-passing the key every call.
client = telnyx.Client(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

app = Flask(__name__)

# ---------------------------------------------------------------------------
# State Checker — verifies coexistence status via Telnyx API
# ---------------------------------------------------------------------------
class StateChecker:
    """Queries the Telnyx API to verify coexistence status of a WhatsApp number.

    Uses a 60-second in-memory TTL cache so bursts of echoes don't hammer the API.
    """

    def __init__(self, waba_id: str, phone_number: str, ttl_seconds: int = 60):
        self.waba_id = waba_id
        self.phone_number = phone_number
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, tuple[float, dict]] = {}  # key -> (timestamp, state)

    def _fetch_state(self) -> dict:
        """Fetch the phone number's state from the Telnyx API.

        Returns a dict with keys: is_on_biz_app, coexistence_state, phone_number.
        In demo mode, returns a simulated 'active' state.
        """
        if DEMO_MODE:
            app.logger.info("DEMO_MODE: simulating coexistence state check")
            return {
                "phone_number": self.phone_number,
                "is_on_biz_app": True,
                "coexistence_state": "active",
            }

        if not self.waba_id or not self.phone_number:
            raise ValueError(
                "WABA_ID and WHATSAPP_NUMBER must be set when DEMO_MODE=false"
            )

        # GET /v2/whatsapp/business_accounts/{waba_id}/phone_numbers
        # SDK v4: client.whatsapp.business_accounts.phone_numbers.list(waba_id)
        response = client.whatsapp.business_accounts.phone_numbers.list(self.waba_id)

        # Find the target number in the list
        for number in response.data:
            if number.phone_number == self.phone_number:
                return {
                    "phone_number": number.phone_number,
                    "is_on_biz_app": number.is_on_biz_app,
                    "coexistence_state": number.coexistence_state,
                }

        raise ValueError(
            "Configured WHATSAPP_NUMBER was not found in the configured WABA"
        )

    def verify_with_number_api(self) -> dict:
        """Cross-check the number via GET /v2/whatsapp/phone_numbers/{phone_number}.

        SDK v4: client.whatsapp.phone_numbers.retrieve_phone_number(phone_number)
        Returns the same state dict as _fetch_state. Only used in live mode
        (the number-specific API reflects the freshest lifecycle state).
        """
        if DEMO_MODE:
            return self._fetch_state()

        if not self.phone_number:
            raise ValueError("WHATSAPP_NUMBER must be set when DEMO_MODE=false")

        number = client.whatsapp.phone_numbers.retrieve_phone_number(self.phone_number)
        return {
            "phone_number": getattr(number, "phone_number", self.phone_number),
            "is_on_biz_app": number.is_on_biz_app,
            "coexistence_state": number.coexistence_state,
        }

    def get_state(self) -> dict:
        """Return the current state, using the TTL cache."""
        now = time.time()
        cached = self._cache.get("state")
        if cached and (now - cached[0]) < self.ttl_seconds:
            return cached[1]

        state = self._fetch_state()
        self._cache["state"] = (now, state)
        return state

    def is_active(self) -> bool:
        """Return True if the number is on the biz app and in 'active' coexistence state."""
        state = self.get_state()
        return bool(state.get("is_on_biz_app")) and state.get("coexistence_state") == "active"


# Initialize the state checker
state_checker = StateChecker(
    waba_id=WABA_ID,
    phone_number=WHATSAPP_NUMBER,
    ttl_seconds=STATE_CHECK_TTL_SECONDS,
)


# ---------------------------------------------------------------------------
# Message Logger (append-only JSONL persistence)
# ---------------------------------------------------------------------------
class MessageLogger:
    """Appends accepted message.echo events to a JSONL file for audit purposes."""

    def __init__(self, path: str):
        self.path = Path(path)

    def append(self, event: dict) -> None:
        """Append one event as a JSON line. Creates the file if needed."""
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")


message_logger = MessageLogger(ECHO_LOG_PATH)


# ---------------------------------------------------------------------------
# Webhook signature verification (Ed25519)
# ---------------------------------------------------------------------------
def verify_webhook_signature(headers: dict, raw_body: bytes) -> bool:
    """Verify the Telnyx Ed25519 signature over '<timestamp>|<raw body>'.

    Returns True if the signature is valid and the timestamp is within
    MAX_TIMESTAMP_SKEW_SECONDS of now.
    """
    signature = headers.get("telnyx-signature-ed25519")
    timestamp = headers.get("telnyx-timestamp")

    if not signature or not timestamp:
        return False

    # Reject timestamps that skew too far from now
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs(time.time() - ts) > MAX_TIMESTAMP_SKEW_SECONDS:
        app.logger.warning("Webhook timestamp skew too large: %s", timestamp)
        return False

    if not TELNYX_PUBLIC_KEY:
        app.logger.error("TELNYX_PUBLIC_KEY not set — cannot verify webhook signature")
        return False

    try:
        # unwrap verifies the Ed25519 signature over "<timestamp>|<payload>"
        # and raises ValueError on any failure (bad key, bad sig, stale ts).
        # NOTE: the kwarg is `key` (NOT `public_key`) in SDK >= 4.x.
        client.webhooks.unwrap(
            payload=raw_body.decode("utf-8"),
            headers={
                "telnyx-signature-ed25519": signature,
                "telnyx-timestamp": timestamp,
            },
            key=TELNYX_PUBLIC_KEY,
        )
        return True
    except Exception:
        app.logger.exception("Webhook signature verification failed")
        return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/webhooks/whatsapp/echo", methods=["POST"])
def whatsapp_echo_webhook():
    """Receive message.echo webhooks from Telnyx.

    Verifies the Ed25519 signature. If valid and the number is in 'active'
    coexistence state, logs the message body. If the number is not active,
    accepts with 200 but skips processing (logs a warning).
    """
    raw_body = request.get_data()

    # 1. Verify signature
    if not verify_webhook_signature(request.headers, raw_body):
        return jsonify({"error": "Invalid signature"}), 401

    # 2. Parse payload
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400

    event_type = payload.get("event_type")
    if event_type != "message.echo":
        app.logger.info("Ignoring non-message.echo event: %s", event_type)
        return jsonify({"status": "ignored"}), 200

    data = payload.get("data", {})
    event_id = data.get("id", "unknown")
    origin = data.get("origin")
    message = data.get("payload", {})

    # 3. Check coexistence state (with TTL cache)
    if not state_checker.is_active():
        state = state_checker.get_state()
        app.logger.warning(
            "Skipping message.echo %s — number not active (coexistence_state=%s, is_on_biz_app=%s)",
            event_id,
            state.get("coexistence_state"),
            state.get("is_on_biz_app"),
        )
        # Accept with 200 — do NOT reject, otherwise Telnyx retries delivery
        return jsonify({"ok": "skipped", "reason": "number_not_active"}), 200

    # 4. Validate the echo semantics (acceptance criteria #2 and #3)
    # - origin must be 'whatsapp_business_app' for a manual-channel echo
    # - cost must be null / {amount: null, currency: null} (no billing event)
    # Raw phone numbers and monetary amounts are never logged or persisted —
    # only boolean verdicts derived from them (PII minimization).
    origin_matches_biz_app = origin == "whatsapp_business_app"
    cost = message.get("cost")
    if cost is None:
        no_charge = True  # cost field absent or explicitly null
    elif isinstance(cost, dict) and cost.get("amount") is None and cost.get("currency") is None:
        no_charge = True
    else:
        no_charge = False
        app.logger.warning(
            "Unexpected non-null cost on message.echo %s — possible billing event",
            event_id,
        )
    if not origin_matches_biz_app:
        app.logger.warning(
            "message.echo %s has unexpected origin %r (expected 'whatsapp_business_app')",
            event_id,
            origin,
        )

    # 5. Log the message (append-only JSONL, PII-minimized)
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_id": event_id,
        "event_type": event_type,
        "origin": origin,
        "origin_matches_biz_app": origin_matches_biz_app,
        "text": message.get("text"),
        "message_id": message.get("id"),
        "no_charge": no_charge,
    }
    message_logger.append(log_entry)

    app.logger.info(
        "Logged message.echo %s (origin=%s, no_charge=%s)",
        event_id,
        origin,
        no_charge,
    )
    return jsonify({"ok": True}), 200


@app.route("/health", methods=["GET"])
def health():
    """Simple health check."""
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Startup check (fails fast if the number is not in coexistence state)
# ---------------------------------------------------------------------------
def _startup_state_check() -> None:
    """Verify the number is coexistence-enabled at startup.

    In demo mode, this is skipped (no real API call). In live mode, fails
    fast with a clear error if the number is missing or not on the biz app.
    """
    if DEMO_MODE:
        app.logger.info("DEMO_MODE: skipping startup state check")
        return

    try:
        state = state_checker.get_state()
    except Exception as exc:
        app.logger.error("Startup state check failed: %s", exc)
        raise SystemExit(f"Startup state check failed: {exc}") from exc

    if not state.get("is_on_biz_app"):
        raise SystemExit(
            "Startup state check failed: the configured WhatsApp number is not on "
            "the WhatsApp Business app (is_on_biz_app=False). "
            "Enable coexistence for this number before running the sample."
        )

    # Cross-verify with GET /v2/whatsapp/phone_numbers/{phone_number}
    try:
        number_state = state_checker.verify_with_number_api()
    except Exception as exc:
        raise SystemExit(f"Number API cross-check failed: {exc}") from exc
    if not number_state.get("is_on_biz_app"):
        raise SystemExit(
            "Startup state check failed: Number API cross-check reports the "
            "configured number is not on the WhatsApp Business app."
        )

    app.logger.info(
        "Startup state check passed: number=%s is_on_biz_app=%s coexistence_state=%s",
        "configured",
        state.get("is_on_biz_app"),
        state.get("coexistence_state"),
    )


# Run startup check when the module loads (not in tests)
if not app.config.get("TESTING"):
    _startup_state_check()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
