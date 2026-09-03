import os
import time
import json
import logging
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import telnyx

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

# --- Telnyx client init ---
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
telnyx.api_key = TELNYX_API_KEY

# --- Config ---
PRIMARY_CONNECTION_ID = os.getenv("TELNYX_PRIMARY_CONNECTION_ID", "")
BACKUP_CONNECTION_ID = os.getenv("TELNYX_BACKUP_CONNECTION_ID", "")
OPS_ALERT_NUMBER = os.getenv("TELNYX_OPS_ALERT_NUMBER", "")
FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "")
FAILURE_THRESHOLD = int(os.getenv("FAILURE_THRESHOLD", "3"))
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "300"))
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("true", "1", "yes")

# --- In-memory KV store (demo mode) ---
# In production, replace with real KV store (e.g., Redis, DynamoDB)
_kv_store = {}


def kv_get(key):
    """Get a value from the KV store."""
    return _kv_store.get(key)


def kv_put(key, value):
    """Put a value into the KV store."""
    _kv_store[key] = value


def kv_increment(key):
    """Increment a counter in the KV store, returning the new value."""
    current = kv_get(key) or 0
    new_val = current + 1
    kv_put(key, new_val)
    return new_val


def get_circuit_state():
    """Retrieve the circuit breaker state for the primary connection."""
    failures = kv_get("primary:failures") or 0
    last_fail = kv_get("primary:last_fail") or 0
    tripped = kv_get("primary:tripped") or False
    return {
        "failures": failures,
        "last_fail": last_fail,
        "tripped": tripped,
    }


def trip_circuit_breaker():
    """Trip the circuit breaker and send an SMS alert."""
    kv_put("primary:tripped", True)
    kv_put("primary:last_fail", time.time())
    alert_msg = (
        f"[{datetime.now(timezone.utc).isoformat()}] "
        f"Circuit breaker TRIPPED for primary SIP connection. "
        f"Failures: {kv_get('primary:failures')}. "
        f"Auto-failover to backup connection {BACKUP_CONNECTION_ID}."
    )
    if DEMO_MODE:
        app.logger.info(f"[DEMO MODE] SMS alert (not sent): {alert_msg}")
    else:
        try:
            telnyx.Message.create(
                from_=FROM_NUMBER,
                to=OPS_ALERT_NUMBER,
                text=alert_msg,
            )
            app.logger.info("SMS alert sent to ops.")
        except Exception:
            app.logger.exception("Failed to send SMS alert.")


def reset_circuit_breaker():
    """Reset the circuit breaker to closed state."""
    kv_put("primary:failures", 0)
    kv_put("primary:tripped", False)
    kv_put("primary:last_fail", 0)
    app.logger.info("Circuit breaker reset to CLOSED state.")


def is_cooldown_expired():
    """Check if the cooldown period has passed since the breaker tripped."""
    last_fail = kv_get("primary:last_fail") or 0
    if last_fail == 0:
        return True
    return (time.time() - last_fail) >= COOLDOWN_SECONDS


def should_route_to_backup():
    """Determine if calls should be routed to the backup connection."""
    state = get_circuit_state()
    if not state["tripped"]:
        return False
    if is_cooldown_expired():
        # Half-open state: test primary
        app.logger.info("Cooldown expired. Entering HALF-OPEN state.")
        return False  # Allow primary test
    return True  # Open state: route to backup


@app.route("/webhooks/call-control", methods=["POST"])
def call_control_webhook():
    """Handle Call Control webhooks, including call failures."""
    try:
        # Verify webhook signature
        telnyx_event = telnyx.Webhook.construct_event(
            payload=request.get_data(as_text=True),
            signature_header=request.headers.get("Telnyx-Signature"),
            secret=os.getenv("TELNYX_WEBHOOK_SECRET", ""),
        )
        payload = telnyx_event.data.payload
        event_type = telnyx_event.data.event_type

        app.logger.info(f"Received webhook event: {event_type}")

        if event_type == "call.state_changed":
            call_state = payload.get("state")
            if call_state in ("failed", "busy", "no_answer"):
                handle_call_failure(payload)

        return jsonify({"status": "ok"}), 200

    except Exception:
        app.logger.exception("Error processing webhook.")
        return jsonify({"error": "Internal server error"}), 500


def handle_call_failure(payload):
    """Handle a call failure by incrementing the circuit breaker."""
    connection_id = payload.get("connection_id", "")
    if connection_id != PRIMARY_CONNECTION_ID:
        app.logger.info(f"Failure on non-primary connection: {connection_id}")
        return

    failures = kv_increment("primary:failures")
    kv_put("primary:last_fail", time.time())
    app.logger.info(f"Primary connection failure count: {failures}")

    if failures >= FAILURE_THRESHOLD:
        state = get_circuit_state()
        if not state["tripped"]:
            trip_circuit_breaker()
        else:
            app.logger.info("Circuit breaker already tripped.")


@app.route("/api/route", methods=["POST"])
def route_call():
    """Determine which SIP connection to use for an outbound call."""
    try:
        to_number = request.json.get("to")
        if not to_number:
            return jsonify({"error": "Missing 'to' parameter"}), 400

        use_backup = should_route_to_backup()
        connection_id = BACKUP_CONNECTION_ID if use_backup else PRIMARY_CONNECTION_ID
        state = get_circuit_state()

        if DEMO_MODE:
            app.logger.info(
                f"[DEMO MODE] Would create call to {to_number} "
                f"via connection {connection_id} "
                f"(tripped={state['tripped']}, failures={state['failures']})"
            )
            return jsonify({
                "demo": True,
                "to": to_number,
                "connection_id": connection_id,
                "circuit_state": state,
                "message": "Demo mode: no real call placed.",
            }), 200

        # Live mode: create actual call via Telnyx Call Control API
        call = telnyx.Call.create(
            from_=FROM_NUMBER,
            to=to_number,
            connection_id=connection_id,
        )
        return jsonify({
            "call_id": call.id,
            "connection_id": connection_id,
            "circuit_state": state,
        }), 201

    except Exception:
        app.logger.exception("Error routing call.")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/circuit-state", methods=["GET"])
def circuit_state():
    """Get the current circuit breaker state."""
    state = get_circuit_state()
    if state["tripped"] and is_cooldown_expired():
        state["status"] = "half-open"
    elif state["tripped"]:
        state["status"] = "open"
    else:
        state["status"] = "closed"
    return jsonify(state), 200


@app.route("/api/circuit-reset", methods=["POST"])
def circuit_reset():
    """Manually reset the circuit breaker."""
    reset_circuit_breaker()
    return jsonify({"status": "reset", "circuit_state": get_circuit_state()}), 200


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "demo_mode": DEMO_MODE}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
