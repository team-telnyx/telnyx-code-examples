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
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
DEMO_NUMBER = "+15550000002"
DEMO_TRANSCRIPT = []

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


def _handle_inbound_sms(payload, send_sms=None):
    """Process an inbound SMS and drive the state machine."""
    send_sms = send_sms or _send_sms
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
            # Treat the first inbound message as the issue description.
            CONVERSATIONS[conv_id] = {
                "status": "awaiting_priority",
                "issue": text,
                "priority": None,
                "created_at": _now_iso(),
                "last_updated_at": _now_iso(),
            }
            reply = (
                f"Got it: \"{text}\"\n\n"
                "What priority is this? Reply LOW, MEDIUM, or HIGH."
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
        send_sms(from_number, reply)
    except Exception:
        app.logger.exception("Failed to send SMS reply")


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


@app.route("/demo", methods=["GET", "POST"])
def demo():
    """Local-only browser demo that simulates inbound SMS messages."""
    if not DEMO_MODE:
        return jsonify({"error": "Demo mode is disabled"}), 404

    if request.method == "POST":
        text = request.form.get("message", "").strip()
        if text:
            DEMO_TRANSCRIPT.append({"role": "You", "text": text})
            replies = []
            _handle_inbound_sms(
                {
                    "to": [{"phone_number": "+15550000001"}],
                    "from": [{"phone_number": DEMO_NUMBER}],
                    "text": text,
                },
                send_sms=lambda _to, body: replies.append(body),
            )
            DEMO_TRANSCRIPT.extend(
                {"role": "Agent", "text": reply} for reply in replies
            )

    html = """
    <!doctype html>
    <html>
      <head>
        <title>Agent SDK Quickstart Demo</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
          .message { padding: 12px; margin: 10px 0; border-radius: 10px; white-space: pre-wrap; }
          .you { background: #e8f1ff; }
          .agent { background: #f0f0f0; }
          form { display: flex; gap: 8px; margin-top: 24px; }
          input { flex: 1; padding: 12px; }
          button { padding: 12px 18px; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Agent SDK Quickstart Demo</h1>
        <p>Simulate the SMS conversation locally. Try: <em>Printer offline</em>, then <em>HIGH</em>.</p>
        {% for item in transcript %}
          <div class="message {{ item.role|lower }}"><strong>{{ item.role }}:</strong> {{ item.text }}</div>
        {% endfor %}
        <form method="post">
          <input name="message" placeholder="Type a simulated SMS…" required autofocus>
          <button type="submit">Send</button>
        </form>
      </body>
    </html>
    """
    return render_template_string(html, transcript=DEMO_TRANSCRIPT)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=False)
