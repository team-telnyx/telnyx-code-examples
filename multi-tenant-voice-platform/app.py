import os
import time
import threading
from collections import defaultdict
from datetime import datetime, timezone
from functools import wraps

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Configure Telnyx SDK
telnyx.api_key = os.getenv("TELNYX_API_KEY")

# --- In-memory stores (replace with real DB/KV in production) ---
# Per-tenant configuration (simulates SQL DB)
TENANT_CONFIG = {
    "tenant_a": {
        "name": "Tenant A",
        "rate_limit_per_minute": 10,
        "default_voice_profile_id": os.getenv("TENANT_A_VOICE_PROFILE_ID", ""),
        "webhook_url": os.getenv("TENANT_A_WEBHOOK_URL", ""),
    },
    "tenant_b": {
        "name": "Tenant B",
        "rate_limit_per_minute": 5,
        "default_voice_profile_id": os.getenv("TENANT_B_VOICE_PROFILE_ID", ""),
        "webhook_url": os.getenv("TENANT_B_WEBHOOK_URL", ""),
    },
}

# Per-tenant rate limiting (simulates KV store)
RATE_LIMIT_STORE = defaultdict(lambda: {"window_start": time.time(), "count": 0})
RATE_LIMIT_LOCK = threading.Lock()

# Per-tenant call state (simulates StatefulActor)
CALL_STATE = defaultdict(dict)
CALL_STATE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Rate limiting helpers
# ---------------------------------------------------------------------------
def check_rate_limit(tenant_id):
    """Check if tenant has exceeded rate limit. Returns (allowed, retry_after)."""
    if tenant_id not in TENANT_CONFIG:
        return False, 0

    limit = TENANT_CONFIG[tenant_id]["rate_limit_per_minute"]
    now = time.time()

    with RATE_LIMIT_LOCK:
        entry = RATE_LIMIT_STORE[tenant_id]

        # Reset window if a minute has passed
        if now - entry["rate_start"] >= 60:
            entry["rate_start"] = now
            entry["count"] = 0

        if entry["count"] >= limit:
            retry_after = int(60 - (now - entry["rate_start"]))
            return False, retry_after

        entry["count"] += 1
        return True, 0


def rate_limit_required(f):
    """Decorator to apply per-tenant rate limiting."""

    @wraps(f)
    def decorated(*args, **kwargs):
        tenant_id = request.headers.get("X-Tenant-ID")
        if not tenant_id:
            return jsonify({"error": "Missing X-Tenant-ID header"}), 400

        allowed, retry_after = check_rate_limit(tenant_id)
        if not allowed:
            response = jsonify({"error": "Rate limit exceeded"})
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            return response

        return f(*args, **kwargs)

    return decorated


# ---------------------------------------------------------------------------
# Tenant verification helper
# ---------------------------------------------------------------------------
def get_tenant_or_404(tenant_id):
    """Validate tenant exists and return config."""
    config = TENANT_CONFIG.get(tenant_id)
    if not config:
        return None
    return config


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.route("/api/tenants", methods=["GET"])
def list_tenants():
    """List all configured tenants (admin endpoint)."""
    return jsonify(
        {
            "tenants": [
                {
                    "id": tid,
                    "name": cfg["name"],
                    "rate_limit_per_minute": cfg["rate_limit_per_minute"],
                }
                for tid, cfg in TENANT_CONFIG.items()
            ]
        }
    )


@app.route("/api/tenants/<tenant_id>/config", methods=["GET"])
def get_tenant_config(tenant_id):
    """Get configuration for a specific tenant."""
    config = get_tenant_or_404(tenant_id)
    if not config:
        return jsonify({"error": "Tenant not found"}), 404

    return jsonify(
        {
            "tenant_id": tenant_id,
            "name": config["name"],
            "rate_limit_per_minute": config["rate_limit_per_minute"],
            "default_voice_number_id": config["default_voice_number_id"],
        }
    )


@app.route("/api/tenants/<tenant_id>/calls", methods=["POST"])
@rate_limit_required
def initiate_call(tenant_id):
    """Initiate a call for a specific tenant."""
    config = get_tenant_or_404(tenant_id)
    if not config:
        return jsonify({"error": "Tenant not found"}), 404

    data = request.get_json()
    if not data or "to" not in data:
        return jsonify({"error": "Missing required field: to"}), 400

    to_number = data["to"]
    from_number = data.get("from", config["default_voice_number_id"])

    try:
        call = telnyx.Call.create(
            to=to_number,
            from_=from_number,
            connection_id=config["connection_id"],
            webhook_url=config["webhook_url"],
        )

        # Store call state
        with CALL_STATE_LOCK:
            CALL_STATE[tenant_id][call.id] = {
                "status": "initiated",
                "to": to_number,
                "from": from_number,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        return jsonify(
            {
                "call_id": call.id,
                "status": "initiated",
                "tenant_id": tenant_id,
            }
        ), 201

    except telnyx.error.TelnyxError as e:
        app.logger.exception("Failed to initiate call for tenant %s", tenant_id)
        return jsonify({"error": "Failed to initiate call"}), 502


@app.route("/api/tenants/<tenant_id>/calls", methods=["GET"])
def list_calls(tenant_id):
    """List call state for a tenant."""
    config = get_tenant_or_404(tenant_id)
    if not config:
        return jsonify({"error": "Tenant not found"}), 404

    with CALL_STATE_LOCK:
        calls = CALL_STATE.get(tenant_id, {})

    return jsonify({"tenant_id": tenant_id, "calls": list(calls.values())})


@app.route("/api/tenants/<tenant_id>/calls/<call_id>", methods=["GET"])
def get_call_state(tenant_id, call_id):
    """Get state for a specific call."""
    config = get_tenant_or_404(tenant_id)
    if not config:
        return jsonify({"error": "Tenant not found"}), 404

    with CALL_STATE_LOCK:
        call = CALL_STATE.get(tenant_id, {}).get(call_id)

    if not call:
        return jsonify({"error": "Call not found"}), 404

    return jsonify({"tenant_id": tenant_id, "call_id": call_id, "state": call})


@app.route("/webhooks/inbound", methods=["POST"])
def inbound_webhook():
    """Handle inbound webhook from Telnyx."""
    try:
        # Verify the webhook signature
        event = telnyx.webhooks.unwrap(
            request.data,
            request.headers.get("Telnyx-Signature-Ed25519", ""),
            request.headers.get("Telnyx-Timestamp", ""),
        )
    except Exception:
        app.logger.exception("Failed to verify webhook signature")
        return jsonify({"error": "Invalid signature"}), 401

    # Extract event data
    payload = event.get("data", {}).get("payload", {})
    event_type = event.get("data", {}).get("event_type", "")

    # Determine tenant from call state
    call_id = payload.get("call_control_id") or payload.get("call_session_id")
    if not call_id:
        app.logger.warning("Webhook received without call ID")
        return jsonify({"status": "ok"}), 200

    # Find which tenant owns this call
    tenant_id = None
    with CALL_STATE_LOCK:
        for tid, calls in CALL_STATE.items():
            if call_id in calls:
                tenant_id = tid
                break

    if not tenant_id:
        app.logger.warning("Call %s not found in any tenant state", call_id)
        return jsonify({"status": "ok"}), 200

    # Update call state
    with CALL_STATE_LOCK:
        call = CALL_STATE[tenant_id].get(call_id, {})
        call["status"] = payload.get("call_status", call.get("status", "unknown"))
        call["last_event"] = payload.get("call_leg_id", "")
        call["last_event_type"] = event_type
        call["updated_at"] = datetime.now(timezone.utc).isoformat()
        CALL_STATE[tenant_id][call_id] = call

    app.logger.info(
        "Updated call %s for tenant %s: %s", call_id, tenant_id, call["status"]
    )

    return jsonify({"status": "ok"}), 200


@app.route("/api/tenants/<tenant_id>/calls/<call_id>/hangup", methods=["POST"])
@rate_limit_required
def hangup_call(tenant_id, call_id):
    """Hang up a call for a tenant."""
    config = get_tenant_or_404(tenant_id)
    if not config:
        return jsonify({"error": "Tenant not found"}), 404

    with CALL_STATE_LOCK:
        call = CALL_STATE.get(tenant_id, {}).get(call_id)

    if not call:
        return jsonify({"error": "Call not found"}), 404

    try:
        telnyx.Call.hangup(call_id)
        with CALL_STATE_LOCK:
            CALL_STATE[tenant_id][call_id]["status"] = "hangup_requested"

        return jsonify({"status": "hangup_requested", "call_id": call_id}), 200

    except telnyx.error.TelnyxError as e:
        app.logger.exception("Failed to hang up call %s for tenant %s", call_id, tenant_id)
        return jsonify({"error": "Failed to hang up call"}), 502


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    app.logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
