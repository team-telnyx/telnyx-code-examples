import os
import json
import time
import threading
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template_string
from telnyx.lib.webhook_verification import verify_webhook_signature

import telnyx

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_MESSAGING_PROFILE_ID = os.getenv("TELNYX_MESSAGING_PROFILE_ID")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER")

if not TELNYX_API_KEY:
    app.logger.warning("TELNYX_API_KEY is not set. API calls will fail.")

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY or "KEY_NOT_CONFIGURED")

# ---------------------------------------------------------------------------
# In-memory state for the demo workflow
# ---------------------------------------------------------------------------
# Maps a conversation_id -> dict with keys:
#   "state": one of "awaiting_issue", "awaiting_priority", "done"
#   "issue": str
#   "priority": str
#   "created_at": ISO timestamp
#   "last_updated": ISO timestamp
CONVERSATIONS = {}
CONVERSATIONS_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _validate_webhook_signature():
    """Verify the Telnyx Ed25519 signature on an inbound webhook."""
    if not TELNYX_PUBLIC_KEY:
        app.logger.error("TELNYX_PUBLIC_KEY is not set; cannot verify webhook signature.")
        return False
    try:
        verify_webhook_signature(request.data, request.headers, TELNYX_PUBLIC_KEY)
        return True
    except Exception:
        app.logger.exception("Webhook signature verification failed.")
        return False


def _send_sms(to_number, body):
    """Send an SMS via the Telnyx Messaging API."""
    if not TELNYX_API_KEY:
        raise RuntimeError("TELNYX_API_KEY is not configured.")
    if not TELNYX_MESSAGING_PROFILE_ID:
        raise RuntimeError("TELNYX_MESSAGING_PROFILE_ID is not configured.")
    if not TELNYX_FROM_NUMBER:
        raise RuntimeError("TELNYX_FROM_NUMBER is not configured.")

    message = telnyx_client.messages.send(
        from_=TELNYX_FROM_NUMBER,
        to=to_number,
        text=body,
        messaging_profile_id=TELNYX_MESSAGING_PROFILE_ID,
    )
    return message


def _handle_inbound_sms(payload):
    """Process an inbound SMS and drive the state machine."""
    to_number = payload.get("to", [{}])[0].get("phone_number")
    from_number = payload.get("from", [{}])[0].get("phone_number")
    text = payload.get("text", "").strip()

    if not to_number or not from_number:
        app.logger.error("Inbound SMS missing to/from numbers.")
        return

    # Use the sender's number as the conversation key.
    conv_id = from_number

    with CONVERSATIONS_LOCK:
        conv = CONVERSATIONS.get(conv_id)

        if conv is None:
            # New conversation: ask for the issue description.
            CONVERSATIONS[conv_id] = {
                "status": "awaiting_issue",
                "issue": None,
                "priority": None,
                "created_at": _now_iso(),
                "last_updated_at": _now_iso(),
            }
            reply = (
                "Welcome to the Telnyx Agent SDK Quickstart!\n"
                "Describe the issue you're experiencing in one short message."
            )
        elif conv["status"] == "awaiting_issue":
            # We have the issue; ask for priority.
            conv["issue"] = text
            conv["status"] = "awaiting_priority"
            conv["last_updated_at"] = _now_iso()
            reply = (
                f"Got it: \"{text}\"\n\n"
                "What priority is this? Reply LOW, MEDIUM, or HIGH."
            )
        elif conv["status"] == "awaiting_priority":
            priority = text.upper()
            if priority not in ("LOW", "MEDIUM", "HIGH"):
                reply = (
                    "I didn't catch that. Please reply LOW, MEDIUM, or HIGH."
                )
            else:
                conv["priority"] = priority
                conv["status"] = "done"
                conv["last_updated_at"] = _now_iso()
                reply = (
                    f"Issue logged!\n\n"
                    f"• Issue: {conv['issue']}\n"
                    f"• Priority: {priority}\n"
                    f"• Conversation ID: {conv_id}\n\n"
                    "A support agent will follow up shortly."
                )
        else:
            # Conversation already done; start fresh.
            CONVERSATIONS[conv_id] = {
                "status": "awaiting_issue",
                "issue": None,
                "priority": None,
                "created_at": _now_iso(),
                "last_updated_at": _now_iso(),
            }
            reply = (
                "New conversation started!\n"
                "Describe the issue you're facing in one short message."
            )

    try:
        _send_sms(from_number, reply)
    except Exception:
        app.logger.exception("Failed to send SMS reply to %s", from_number)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    """Landing page showing the demo state."""
    with CONVERSATIONS_LOCK:
        snapshot = [
            {
                "conversation_id": f"***{cid[-4:]}",
                "status": c["status"],
                "priority": c["priority"],
                "created_at": c["created_at"],
                "last_updated_at": c["last_updated_at"],
            }
            for cid, c in sorted(
                CONVERSATIONS.items(),
                key=lambda item: item[1]["created_at"],
                reverse=True,
            )
        ]

    html = """
    <!doctype html>
    <html>
      <head><title>Agent SDK Quickstart</title></head>
      <body>
        <h1>Telnyx Agent SDK Quickstart</h1>
        <p>This demo runs a simple SMS-based issue triage flow.</p>
        <p>Send an SMS to your Telnyx number to start a conversation.</p>
        <h2>Active conversations</h2>
        {% if conversations %}
          <table border="1" cellpadding="6">
            <tr>
              <th>Conversation ID</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Created (UTC)</th>
              <th>Last Updated (UTC)</th>
            </tr>
            {% for c in conversations %}
            <tr>
              <td>{{ c.conversation_id }}</td>
              <td>{{ c.status }}</td>
              <td>{{ c.priority or "—" }}</td>
              <td>{{ c.created_at }}</td>
              <td>{{ c.last_updated_at }}</td>
            </tr>
            {% endfor %}
          </table>
        {% else %}
          <p>No conversations yet.</p>
        {% endif %}
      </body>
    </html>
    """
    return render_template_string(html, conversations=snapshot)


@app.post("/webhooks/sms")
def sms_webhook():
    """Receive an inbound SMS webhook from Telnyx."""
    if not _validate_webhook_signature():
        return jsonify({"error": "Invalid signature"}), 401

    try:
        data = request.get_json(force=True)
    except Exception:
        app.logger.exception("Failed to parse webhook JSON body.")
        return jsonify({"error": "Invalid JSON"}), 400

    event_type = data.get("data", {}).get("event_type")
    if event_type != "message.received":
        app.logger.info("Ignoring non-message event: %s", event_type)
        return jsonify({"status": "ignored"}), 200

    payload = data.get("data", {}).get("payload", {})
    try:
        _handle_inbound_sms(payload)
    except Exception:
        app.logger.exception("Error handling inbound SMS.")
        return jsonify({"error": "Internal error"}), 500

    return jsonify({"status": "ok"}), 200


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=False)
