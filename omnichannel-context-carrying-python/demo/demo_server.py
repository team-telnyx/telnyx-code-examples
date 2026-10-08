"""Single-file demo for the omnichannel context-carrying AI agent.

Runs the full Email -> Voice -> SMS journey without Telnyx credentials.
Mock APIs simulate the booking-change scenario where context carries
across channels — the AI greets the caller with details from their email.

Run from the omnichannel-context-carrying-python/ directory:
    python demo/demo_server.py

Then open http://localhost:5555/ in your browser and click "Run Demo Journey".
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

# Put the project root on sys.path so `import app` works regardless of CWD.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Hermetic demo environment — set BEFORE importing app.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key")
os.environ.setdefault("TELNYX_FROM_NUMBER", "+15555550100")
os.environ.setdefault("TELNYX_EMAIL_FROM", "agent@demo.telnyx.com")
os.environ.setdefault("CONNECTION_ID", "demo_connection_id")
os.environ.setdefault("DB_PATH", os.path.join(_PROJECT_ROOT, "demo_conversations.db"))
os.environ.setdefault("PORT", "5555")

# Clean any stale demo DB so each run starts fresh.
_demo_db = os.environ["DB_PATH"]
if os.path.exists(_demo_db):
    os.remove(_demo_db)

# ---------------------------------------------------------------------------
# Mock Telnyx Inference API — scripted responses for the booking scenario
# ---------------------------------------------------------------------------
_SCRIPTED_RESPONSES = {
    # Step 1: AI replies to Sarah's email about the booking change
    "email_reply": {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": "I'll acknowledge Sarah's booking change request via email.",
                "tool_calls": [{
                    "id": "tool_001",
                    "type": "function",
                    "function": {
                        "name": "send_email",
                        "arguments": json.dumps({
                            "subject": "Re: Booking Change Request — BK-2024-1234",
                            "body": (
                                "Dear Sarah,\n\n"
                                "Thank you for reaching out about your booking BK-2024-1234. "
                                "I've received your request to change the date from October 15 "
                                "to October 22.\n\n"
                                "I'm reviewing availability for the new date and will confirm "
                                "shortly. Your reference number for this change request is "
                                "CR-2024-0891.\n\n"
                                "You can reach us on any channel — phone, text, or email — "
                                "and we'll have your full context ready.\n\n"
                                "Best regards,\n"
                                "TelnyxDemo Corp"
                            ),
                        }),
                    },
                }],
            },
        }],
    },
    # Step 1b: Final text after email tool call
    "email_done": {
        "choices": [{
            "finish_reason": "stop",
            "message": {
                "role": "assistant",
                "content": "Email reply sent acknowledging the booking change request.",
            },
        }],
    },
    # Step 2: Contextual greeting when Sarah calls
    "voice_greeting": (
        "Hi Sarah! I see you emailed us about changing booking BK-2024-1234 "
        "from October 15 to October 22. Are you calling about the same request?"
    ),
    # Step 3: AI processes Sarah's voice confirmation and sends SMS
    "voice_response": {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "tool_003",
                        "type": "function",
                        "function": {
                            "name": "send_sms",
                            "arguments": json.dumps({
                                "text": (
                                    "Hi Sarah, your booking BK-2024-1234 has been updated "
                                    "to October 22. Confirmation ref: CR-2024-0891. "
                                    "Reply HELP for assistance."
                                ),
                            }),
                        },
                    },
                    {
                        "id": "tool_004",
                        "type": "function",
                        "function": {
                            "name": "resolve_issue",
                            "arguments": json.dumps({
                                "summary": (
                                    "Booking BK-2024-1234 changed from Oct 15 to Oct 22. "
                                    "Customer notified via email, voice, and SMS confirmation."
                                ),
                            }),
                        },
                    },
                ],
            },
        }],
    },
    # Step 3b: Final text after voice tool calls
    "voice_done": {
        "choices": [{
            "finish_reason": "stop",
            "message": {
                "role": "assistant",
                "content": (
                    "Done! I've updated your booking to October 22 and sent you "
                    "a confirmation text. Is there anything else I can help with?"
                ),
            },
        }],
    },
}

_demo_step = "idle"


def _mock_call_inference(messages):
    """Return scripted responses based on the current demo step."""
    global _demo_step
    time.sleep(1.5)

    user_content = ""
    for m in messages:
        if m.get("role") == "user":
            user_content = m.get("content", "")

    # Determine which scripted response to return
    if "Inbound email from customer" in user_content or "Reply to this email" in user_content:
        if _demo_step == "email_tool_done":
            _demo_step = "email_complete"
            return _SCRIPTED_RESPONSES["email_done"]
        _demo_step = "email_tool_done"
        return _SCRIPTED_RESPONSES["email_reply"]

    if "Generate a contextual greeting" in user_content:
        return {
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": _SCRIPTED_RESPONSES["voice_greeting"],
                },
            }],
        }

    if "Customer just said on the phone" in user_content:
        if _demo_step == "voice_tool_done":
            _demo_step = "voice_complete"
            return _SCRIPTED_RESPONSES["voice_done"]
        _demo_step = "voice_tool_done"
        return _SCRIPTED_RESPONSES["voice_response"]

    # Default fallback
    return {
        "choices": [{
            "finish_reason": "stop",
            "message": {
                "role": "assistant",
                "content": "Processing complete.",
            },
        }],
    }


# ---------------------------------------------------------------------------
# Mock Telnyx API calls — print instead of sending
# ---------------------------------------------------------------------------
_demo_log = []


def _mock_send_email(to_email, subject, body):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "email",
        "to": to_email,
        "subject": subject,
        "body": body[:200] + "..." if len(body) > 200 else body,
    }
    _demo_log.append(entry)
    print(f"\n  EMAIL -> {to_email}")
    print(f"     Subject: {subject}")
    print(f"     Body: {body[:120]}...")
    return {"data": {"id": "demo-email-001"}}


def _mock_send_sms(to_number, text):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "sms",
        "to": to_number,
        "text": text,
    }
    _demo_log.append(entry)
    print(f"\n  SMS -> {to_number}")
    print(f"     Text: {text[:120]}...")
    return {"data": {"id": "demo-sms-001"}}


def _mock_make_call(to_number, speak_text):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "voice",
        "to": to_number,
        "speak_text": speak_text[:200] + "..." if len(speak_text) > 200 else speak_text,
    }
    _demo_log.append(entry)
    print(f"\n  VOICE -> {to_number}")
    print(f"     Will speak: {speak_text[:120]}...")
    return {"data": {"id": "demo-call-001"}}


def _mock_generate_contextual_greeting(customer_id):
    """Return the scripted contextual greeting."""
    time.sleep(1)
    return _SCRIPTED_RESPONSES["voice_greeting"]


# ---------------------------------------------------------------------------
# Import and patch the real app
# ---------------------------------------------------------------------------
import app as real_app  # noqa: E402

real_app.init_db()

# Patch the inference and channel functions
real_app.call_inference = _mock_call_inference
real_app.send_email = _mock_send_email
real_app.send_sms = _mock_send_sms
real_app.make_call = _mock_make_call
real_app.generate_contextual_greeting = _mock_generate_contextual_greeting

from app import app  # noqa: E402
from flask import jsonify  # noqa: E402


# ---------------------------------------------------------------------------
# Demo journey — simulates the full email -> voice -> SMS flow
# ---------------------------------------------------------------------------
DEMO_CUSTOMER = {
    "id": "cust_sarah_chen",
    "name": "Sarah Chen",
    "email": "sarah.chen@example.com",
    "phone": "+15555550199",
}


def _run_demo_journey():
    """Simulate the full customer journey via webhook payloads."""
    global _demo_step
    _demo_step = "idle"

    client = app.test_client()

    # Register the customer
    real_app.register_customer(
        DEMO_CUSTOMER["id"],
        DEMO_CUSTOMER["name"],
        email=DEMO_CUSTOMER["email"],
        phone=DEMO_CUSTOMER["phone"],
    )
    real_app.sse_publish("journey.step", {
        "step": "customer_registered",
        "customer_id": DEMO_CUSTOMER["id"],
        "detail": f"Registered: {DEMO_CUSTOMER['name']} ({DEMO_CUSTOMER['email']}, {DEMO_CUSTOMER['phone']})",
    })
    print(f"\n  [1/6] Customer registered: {DEMO_CUSTOMER['name']}")
    time.sleep(1)

    # Step 1: Sarah sends an email about her booking change
    print("  [2/6] Simulating inbound email...")
    real_app.sse_publish("journey.step", {
        "step": "demo_step",
        "customer_id": DEMO_CUSTOMER["id"],
        "detail": "Step 1: Sarah emails about booking change",
    })
    client.post("/webhooks/email", json={
        "data": {
            "event_type": "email.received",
            "payload": {
                "from": {"email": DEMO_CUSTOMER["email"]},
                "subject": "Change booking BK-2024-1234",
                "body": (
                    "Hi, I need to change my booking BK-2024-1234 from "
                    "October 15 to October 22. Is that possible? Thanks, Sarah"
                ),
            },
        },
    })
    time.sleep(5)  # Wait for AI email reply to process

    # Step 2: Sarah calls from her registered phone
    print("  [3/6] Simulating inbound voice call...")
    real_app.sse_publish("journey.step", {
        "step": "demo_step",
        "customer_id": DEMO_CUSTOMER["id"],
        "detail": "Step 2: Sarah calls — AI will greet with email context",
    })
    client.post("/webhooks/voice", json={
        "data": {
            "event_type": "call.initiated",
            "payload": {
                "direction": "incoming",
                "from": {"phone_number": DEMO_CUSTOMER["phone"]},
                "call_control_id": "demo-call-ctrl-001",
            },
        },
    })
    time.sleep(1)

    # Step 3: Call is answered — AI generates contextual greeting
    print("  [4/6] Call answered — generating contextual greeting...")
    client.post("/webhooks/voice", json={
        "data": {
            "event_type": "call.answered",
            "payload": {
                "from": {"phone_number": DEMO_CUSTOMER["phone"]},
                "call_control_id": "demo-call-ctrl-001",
            },
        },
    })
    time.sleep(3)

    # Step 4: Sarah confirms — "Yes, go ahead and change it"
    print("  [5/6] Sarah confirms the change...")
    real_app.sse_publish("journey.step", {
        "step": "demo_step",
        "customer_id": DEMO_CUSTOMER["id"],
        "detail": "Step 3: Sarah says 'Yes, go ahead and change it'",
    })
    client.post("/webhooks/voice", json={
        "data": {
            "event_type": "call.gather.ended",
            "payload": {
                "from": {"phone_number": DEMO_CUSTOMER["phone"]},
                "call_control_id": "demo-call-ctrl-001",
                "speech": {"result": "Yes, go ahead and change it to October 22 please."},
            },
        },
    })
    time.sleep(5)  # Wait for AI to process and send SMS confirmation

    # Step 5: Call ends
    print("  [6/6] Call ended — journey complete!")
    client.post("/webhooks/voice", json={
        "data": {
            "event_type": "call.hangup",
            "payload": {
                "from": {"phone_number": DEMO_CUSTOMER["phone"]},
                "call_control_id": "demo-call-ctrl-001",
            },
        },
    })
    time.sleep(1)

    real_app.sse_publish("agent.done", {
        "content": (
            "Journey complete! Context carried across all three channels:\n\n"
            "1. Email in — Sarah requested booking change\n"
            "2. Email out — AI acknowledged with reference number\n"
            "3. Voice in — AI greeted Sarah with email context\n"
            "4. Voice — Sarah confirmed, AI processed the change\n"
            "5. SMS out — Confirmation text sent\n\n"
            "The customer never had to repeat herself."
        ),
    })
    print("\n  Journey complete!")


@app.route("/demo/journey", methods=["POST"])
def demo_journey():
    """Trigger the full scripted demo journey."""
    import threading
    threading.Thread(target=_run_demo_journey, daemon=True).start()
    return jsonify({"status": "journey_started"})


# ---------------------------------------------------------------------------
# Demo routes
# ---------------------------------------------------------------------------
@app.route("/demo/log", methods=["GET"])
def demo_log():
    """View the demo event log."""
    return jsonify(_demo_log)


@app.route("/demo/reset", methods=["POST"])
def demo_reset():
    """Reset demo state for a fresh run."""
    global _demo_step
    _demo_step = "idle"
    _demo_log.clear()
    import sqlite3
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("DELETE FROM conversations")
    conn.execute("DELETE FROM customers")
    conn.commit()
    conn.close()
    return jsonify({"status": "reset"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5555"))

    print(f"\n  Omnichannel Context-Carrying AI Agent — demo server")
    print(f"  Dashboard:       http://localhost:{port}/")
    print(f"  Demo journey:    POST http://localhost:{port}/demo/journey")
    print(f"  Customers:       http://localhost:{port}/customers")
    print(f"  Conversations:   http://localhost:{port}/conversations")
    print(f"  Demo log:        http://localhost:{port}/demo/log")
    print(f"  Health:          http://localhost:{port}/health")
    print(f"\n  Open http://localhost:{port}/ and click 'Run Demo Journey' to start.\n")

    app.run(host="0.0.0.0", port=port, debug=False)
