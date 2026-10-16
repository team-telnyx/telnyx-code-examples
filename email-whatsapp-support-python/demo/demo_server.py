"""Demo server for the Email & WhatsApp customer support dashboard.

Runs the full damaged-order journey without Telnyx credentials.
Mock functions replace real API calls; the AI agentic loop in app.py
runs with scripted inference responses so all outbound actions happen
automatically from just 2 inbound webhook payloads.

Run from the email-whatsapp-support-python/ directory:
    python demo/demo_server.py

Then open http://localhost:5050/ and click "Run Demo Journey".
"""

import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone

# Put the project root on sys.path so `import app` works regardless of CWD.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Hermetic demo environment — set BEFORE importing app.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key")
os.environ.setdefault("TELNYX_EMAIL_FROM", "harpreet@telnyx.com")
os.environ.setdefault("WHATSAPP_NUMBER", "+15550001234")
os.environ.setdefault("MESSAGING_PROFILE_ID", "demo_profile_id")
os.environ.setdefault("DB_PATH", os.path.join(_PROJECT_ROOT, "demo_support.db"))
os.environ.setdefault("PORT", "5050")
os.environ.setdefault("DEMO_MODE", "demo")

# Clean any stale demo DB so each run starts fresh.
_demo_db = os.environ["DB_PATH"]
if os.path.exists(_demo_db):
    os.remove(_demo_db)

# ---------------------------------------------------------------------------
# Mock Telnyx API calls — log instead of sending
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


def _mock_send_whatsapp(to_number, text, template=None, media_url=None):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "whatsapp",
        "to": to_number,
        "text": text[:200] + "..." if len(text) > 200 else text,
        "media_url": media_url,
    }
    _demo_log.append(entry)
    print(f"\n  WHATSAPP -> {to_number}")
    print(f"     Text: {text[:120]}...")
    if media_url:
        print(f"     Media: {media_url}")
    return {"data": {"id": "demo-wa-001"}}


# ---------------------------------------------------------------------------
# Mock AI Inference — scripted tool calls for the demo journey
# ---------------------------------------------------------------------------
_demo_step = "start"


def _mock_call_inference(messages):
    """Return scripted responses that drive the 5-step demo journey.

    The agentic loop in app.py calls this instead of the real Telnyx API.
    We inspect the user message to determine which step we're on, then
    return pre-built tool_calls that the loop executes automatically.
    """
    global _demo_step
    time.sleep(1.5)  # Simulate inference latency

    user_content = ""
    has_tool_results = False
    for m in messages:
        if m.get("role") == "user":
            user_content = m.get("content", "")
        if m.get("role") == "tool":
            has_tool_results = True

    # --- Email inbound: first call → tool calls ---
    if "Inbound email from customer" in user_content and "Handle this customer email" in user_content:
        if has_tool_results:
            # Tools already executed, finish the loop
            return {
                "choices": [{
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "I've acknowledged Maria's email, updated the order status, and sent a WhatsApp message requesting a damage photo.",
                    },
                }],
            }
        _demo_step = "email_processed"
        return {
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": "I'll acknowledge the damage report via email, update the order status, and request a photo via WhatsApp.",
                    "tool_calls": [
                        {
                            "id": "call_email_ack",
                            "type": "function",
                            "function": {
                                "name": "send_email",
                                "arguments": json.dumps({
                                    "to_email": "maria.santos@example.com",
                                    "subject": "Re: Damaged Order \u2014 ORD-2024-7891",
                                    "body": (
                                        "Dear Maria,\n\n"
                                        "Thank you for contacting us about your damaged order ORD-2024-7891. "
                                        "We're sorry to hear about the condition of your Wireless Noise-Cancelling Headphones.\n\n"
                                        "To expedite your replacement, we'll reach out to you on WhatsApp "
                                        "to collect a photo of the damage. Please have your phone ready.\n\n"
                                        "Reference: SR-2024-0456\n\n"
                                        "Best regards,\n"
                                        "TelnyxDemo Corp Support"
                                    ),
                                }),
                            },
                        },
                        {
                            "id": "call_order_damage",
                            "type": "function",
                            "function": {
                                "name": "update_order",
                                "arguments": json.dumps({
                                    "order_id": "ORD-2024-7891",
                                    "status": "damage_reported",
                                }),
                            },
                        },
                        {
                            "id": "call_wa_photo_req",
                            "type": "function",
                            "function": {
                                "name": "send_whatsapp",
                                "arguments": json.dumps({
                                    "to_number": "+31626781895",
                                    "text": (
                                        "Hi Maria! This is TelnyxDemo Corp Support regarding your "
                                        "damaged order ORD-2024-7891.\n\n"
                                        "Could you please send us a photo of the damaged headphones? "
                                        "This will help us process your replacement quickly."
                                    ),
                                }),
                            },
                        },
                    ],
                },
            }],
        }

    # --- WhatsApp photo inbound: first call → tool calls ---
    if "Inbound WhatsApp message from customer" in user_content and "Handle this WhatsApp message" in user_content:
        if has_tool_results:
            # Check if resolve_case was already called
            for m in messages:
                if m.get("role") == "tool":
                    try:
                        result = json.loads(m.get("content", "{}"))
                        if result.get("status") == "resolved":
                            return {
                                "choices": [{
                                    "finish_reason": "stop",
                                    "message": {
                                        "role": "assistant",
                                        "content": "Case resolved. Maria's replacement headphones have been shipped and she's been notified via both WhatsApp and email.",
                                    },
                                }],
                            }
                    except (json.JSONDecodeError, TypeError):
                        pass
            # Second round of tools: shipping email + resolve
            _demo_step = "resolving"
            return {
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": "Now I'll send the shipping confirmation email and close the case.",
                        "tool_calls": [
                            {
                                "id": "call_ship_email",
                                "type": "function",
                                "function": {
                                    "name": "send_email",
                                    "arguments": json.dumps({
                                        "to_email": "maria.santos@example.com",
                                        "subject": "Replacement Shipped \u2014 ORD-2024-7891",
                                        "body": (
                                            "Dear Maria,\n\n"
                                            "Great news! Your replacement Wireless Noise-Cancelling Headphones "
                                            "have been shipped.\n\n"
                                            "Replacement Tracking: 1Z999AA10987654321\n"
                                            "Estimated Delivery: 2-3 business days\n\n"
                                            "No need to return the damaged pair \u2014 you can recycle or dispose "
                                            "of it at your convenience.\n\n"
                                            "Reference: SR-2024-0456\n\n"
                                            "Thank you for your patience, and we apologize for the inconvenience.\n\n"
                                            "Best regards,\n"
                                            "TelnyxDemo Corp Support"
                                        ),
                                    }),
                                },
                            },
                            {
                                "id": "call_order_resolved",
                                "type": "function",
                                "function": {
                                    "name": "update_order",
                                    "arguments": json.dumps({
                                        "order_id": "ORD-2024-7891",
                                        "status": "resolved",
                                    }),
                                },
                            },
                            {
                                "id": "call_resolve",
                                "type": "function",
                                "function": {
                                    "name": "resolve_case",
                                    "arguments": json.dumps({
                                        "summary": (
                                            "Damaged-order support completed across Email & WhatsApp:\n"
                                            "1. Customer reported damaged headphones via email\n"
                                            "2. Acknowledged via email, requested photo via WhatsApp\n"
                                            "3. Customer sent damage photo via WhatsApp\n"
                                            "4. Replacement approved and confirmed via WhatsApp\n"
                                            "5. Shipping confirmation sent via email\n"
                                            "Order ORD-2024-7891: delivered \u2192 damage_reported \u2192 replacement_shipping \u2192 resolved"
                                        ),
                                    }),
                                },
                            },
                        ],
                    },
                }],
            }
        # First round: photo received → update order + confirm replacement on WA
        _demo_step = "wa_photo_processed"
        return {
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": "I can see the damage photo. I'll update the order, confirm the replacement via WhatsApp, and prepare the shipping confirmation.",
                    "tool_calls": [
                        {
                            "id": "call_order_photo",
                            "type": "function",
                            "function": {
                                "name": "update_order",
                                "arguments": json.dumps({
                                    "order_id": "ORD-2024-7891",
                                    "damage_photo_url": "https://example.com/damage-photo-001.jpg",
                                }),
                            },
                        },
                        {
                            "id": "call_wa_confirm",
                            "type": "function",
                            "function": {
                                "name": "send_whatsapp",
                                "arguments": json.dumps({
                                    "to_number": "+31626781895",
                                    "text": (
                                        "Thank you for the photo, Maria. We can clearly see the damage "
                                        "and have approved a replacement.\n\n"
                                        "A new pair of Wireless Noise-Cancelling Headphones will be "
                                        "shipped to you today. You'll receive a shipping confirmation "
                                        "email shortly with tracking details."
                                    ),
                                }),
                            },
                        },
                        {
                            "id": "call_order_shipping",
                            "type": "function",
                            "function": {
                                "name": "update_order",
                                "arguments": json.dumps({
                                    "order_id": "ORD-2024-7891",
                                    "status": "replacement_shipping",
                                    "replacement_tracking": "1Z999AA10987654321",
                                }),
                            },
                        },
                    ],
                },
            }],
        }

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
# Import and patch the real app
# ---------------------------------------------------------------------------
import app as real_app  # noqa: E402

real_app.init_db()

# Patch channel functions and inference with mocks
real_app.send_email = _mock_send_email
real_app.send_whatsapp = _mock_send_whatsapp
real_app.call_inference = _mock_call_inference

from app import app  # noqa: E402
from flask import jsonify  # noqa: E402


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------
DEMO_CUSTOMER = {
    "id": "cust_maria_santos",
    "name": "Maria Santos",
    "email": "maria.santos@example.com",
    "phone": "+31626781895",
}

DEMO_ORDER = {
    "id": "ORD-2024-7891",
    "product": "Wireless Noise-Cancelling Headphones",
    "status": "delivered",
    "tracking": "1Z999AA10123456784",
}


# ---------------------------------------------------------------------------
# Simplified journey — only sends 2 inbound webhook payloads.
# The AI agentic loop (with mock inference) handles all outbound steps.
# ---------------------------------------------------------------------------
def _run_demo_journey():
    """Simulate the customer support journey via webhook payloads.

    Only 2 actions are scripted: the inbound email and the inbound WhatsApp
    photo. Everything else (email ack, WhatsApp photo request, replacement
    confirmation, shipping email, order updates) happens automatically via
    the AI agentic loop in app.py.
    """
    global _demo_step
    _demo_step = "start"
    client = app.test_client()

    # Register the customer
    real_app.register_customer(
        DEMO_CUSTOMER["id"],
        DEMO_CUSTOMER["name"],
        email=DEMO_CUSTOMER["email"],
        phone=DEMO_CUSTOMER["phone"],
    )
    real_app.sse_publish("customer.registered", {
        "customer": {
            **DEMO_CUSTOMER,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    })
    print(f"\n  [Setup] Customer registered: {DEMO_CUSTOMER['name']}")

    # Create the order
    real_app.create_order(
        DEMO_ORDER["id"],
        DEMO_CUSTOMER["id"],
        DEMO_ORDER["product"],
        status=DEMO_ORDER["status"],
        tracking=DEMO_ORDER["tracking"],
    )
    real_app.sse_publish("order.update", {
        "order": {
            **DEMO_ORDER,
            "customer_id": DEMO_CUSTOMER["id"],
            "damage_photo_url": None,
            "replacement_tracking": None,
        },
    })
    print(f"  [Setup] Order created: {DEMO_ORDER['id']}")
    time.sleep(2)

    # -----------------------------------------------------------------------
    # Step 1: Maria emails about damaged headphones (inbound email)
    # The agentic loop will automatically:
    #   - Send acknowledgment email
    #   - Update order status to damage_reported
    #   - Send WhatsApp message requesting damage photo
    # -----------------------------------------------------------------------
    print("\n  [Step 1] Inbound email — Maria reports damage...")
    real_app.sse_publish("journey.progress", {"step": 1})
    time.sleep(0.5)

    client.post("/webhooks/email", json={
        "data": {
            "event_type": "email.received",
            "payload": {
                "from": {"email": DEMO_CUSTOMER["email"]},
                "subject": "Damaged Order \u2014 ORD-2024-7891",
                "body": (
                    "Hi,\n\n"
                    "I received my order ORD-2024-7891 (Wireless Noise-Cancelling "
                    "Headphones) today but the box was crushed and the left ear cup "
                    "is cracked. The headphones won't turn on.\n\n"
                    "I'd like a replacement please.\n\n"
                    "Thanks,\nMaria Santos"
                ),
            },
        },
    })

    # Wait for the agentic loop to finish processing
    time.sleep(8)
    real_app.sse_publish("journey.progress", {"step": 3})

    # -----------------------------------------------------------------------
    # Step 2: Maria sends photo + description via WhatsApp (inbound WA)
    # The agentic loop will automatically:
    #   - Update order with damage photo URL
    #   - Confirm replacement on WhatsApp
    #   - Update order to replacement_shipping
    #   - Send shipping confirmation email
    #   - Update order to resolved
    #   - Resolve the case
    # -----------------------------------------------------------------------
    print("\n  [Step 2] Inbound WhatsApp — Maria sends damage photo...")
    real_app.sse_publish("journey.progress", {"step": 4})
    time.sleep(0.5)

    client.post("/webhooks/whatsapp", json={
        "data": {
            "event_type": "message.received",
            "payload": {
                "direction": "inbound",
                "from": {"phone_number": DEMO_CUSTOMER["phone"]},
                "text": "Here's the photo. The left ear cup is completely cracked and there's a dent on the headband.",
                "media": [
                    {"url": "https://example.com/damage-photo-001.jpg", "content_type": "image/jpeg"},
                ],
            },
        },
    })

    # Wait for the agentic loop to finish
    time.sleep(12)

    # Mark all progress steps complete
    real_app.sse_publish("journey.progress", {"step": 5})
    print("\n  Journey complete!")


# ---------------------------------------------------------------------------
# Demo routes
# ---------------------------------------------------------------------------
@app.route("/demo/journey", methods=["POST"])
def demo_journey():
    """Trigger the full scripted demo journey."""
    import threading
    threading.Thread(target=_run_demo_journey, daemon=True).start()
    return jsonify({"status": "journey_started"})


@app.route("/demo/log", methods=["GET"])
def demo_log():
    """View the demo event log."""
    return jsonify(_demo_log)


@app.route("/demo/reset", methods=["POST"])
def demo_reset():
    """Reset demo state for a fresh run."""
    global _demo_step
    _demo_step = "start"
    _demo_log.clear()
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("DELETE FROM conversations")
    conn.execute("DELETE FROM customers")
    conn.execute("DELETE FROM orders")
    conn.commit()
    conn.close()
    return jsonify({"status": "reset"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))

    print(f"\n  Customer Support (Email & WhatsApp) — demo server")
    print(f"  Dashboard:       http://localhost:{port}/")
    print(f"  Demo journey:    POST http://localhost:{port}/demo/journey")
    print(f"  Customers:       http://localhost:{port}/customers")
    print(f"  Conversations:   http://localhost:{port}/conversations")
    print(f"  Orders:          http://localhost:{port}/orders")
    print(f"  Demo log:        http://localhost:{port}/demo/log")
    print(f"  Health:          http://localhost:{port}/health")
    print(f"\n  Open http://localhost:{port}/ and click 'Run Demo Journey' to start.\n")

    app.run(host="0.0.0.0", port=port, debug=False)
