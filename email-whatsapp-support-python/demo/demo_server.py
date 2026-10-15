"""Demo server for the Email & WhatsApp customer support dashboard.

Runs the full 5-step damaged-order journey without Telnyx credentials.
Mock functions replace real API calls; a scripted journey plays out
via webhook payloads posted to the Flask test client.

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
os.environ.setdefault("TELNYX_EMAIL_FROM", "support@telnyxdemo.com")
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
# Import and patch the real app
# ---------------------------------------------------------------------------
import app as real_app  # noqa: E402

real_app.init_db()

# Patch channel functions with mocks
real_app.send_email = _mock_send_email
real_app.send_whatsapp = _mock_send_whatsapp

from app import app  # noqa: E402
from flask import jsonify  # noqa: E402


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------
DEMO_CUSTOMER = {
    "id": "cust_maria_santos",
    "name": "Maria Santos",
    "email": "maria.santos@example.com",
    "phone": "+15551234567",
}

DEMO_ORDER = {
    "id": "ORD-2024-7891",
    "product": "Wireless Noise-Cancelling Headphones",
    "status": "delivered",
    "tracking": "1Z999AA10123456784",
}


# ---------------------------------------------------------------------------
# Scripted 5-step journey
# ---------------------------------------------------------------------------
def _run_demo_journey():
    """Simulate the full customer support journey via webhook payloads."""
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
    # Step 1a: Maria emails about damaged headphones (inbound email)
    # -----------------------------------------------------------------------
    print("\n  [Step 1a] Inbound email — Maria reports damage...")
    real_app.sse_publish("journey.progress", {"step": 1})
    time.sleep(0.5)

    client.post("/webhooks/email", json={
        "data": {
            "event_type": "email.received",
            "payload": {
                "from": {"email": DEMO_CUSTOMER["email"]},
                "subject": "Damaged Order — ORD-2024-7891",
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

    # Update order status
    real_app.update_order(DEMO_ORDER["id"], status="damage_reported")
    real_app.sse_publish("order.update", {
        "order": {
            **DEMO_ORDER,
            "customer_id": DEMO_CUSTOMER["id"],
            "status": "damage_reported",
            "damage_photo_url": None,
            "replacement_tracking": None,
        },
    })
    time.sleep(3)

    # -----------------------------------------------------------------------
    # Step 1b: Auto-acknowledgment email (outbound email)
    # -----------------------------------------------------------------------
    print("  [Step 1b] Outbound email — acknowledgment...")
    ack_subject = "Re: Damaged Order — ORD-2024-7891"
    ack_body = (
        "Dear Maria,\n\n"
        "Thank you for contacting us about your damaged order ORD-2024-7891. "
        "We're sorry to hear about the condition of your headphones.\n\n"
        "To expedite your replacement, we'll reach out to you on WhatsApp "
        "to collect a photo of the damage. Please have your phone ready.\n\n"
        "Reference: SR-2024-0456\n\n"
        "Best regards,\n"
        "TelnyxDemo Corp Support"
    )
    _mock_send_email(DEMO_CUSTOMER["email"], ack_subject, ack_body)
    real_app.store_message(
        DEMO_CUSTOMER["id"], "email", "assistant",
        f"Subject: {ack_subject}\n{ack_body}",
    )
    real_app.sse_publish("channel.email", {
        "direction": "outbound",
        "from": "support@telnyxdemo.com",
        "subject": ack_subject,
        "body": ack_body,
        "customer": DEMO_CUSTOMER,
    })
    time.sleep(3)

    # -----------------------------------------------------------------------
    # Step 2: WhatsApp template message requesting damage photo (outbound WA)
    # -----------------------------------------------------------------------
    print("  [Step 2] Outbound WhatsApp — requesting damage photo...")
    real_app.sse_publish("journey.progress", {"step": 2})
    time.sleep(0.5)

    wa_request_text = (
        "Hi Maria! This is TelnyxDemo Corp Support regarding your "
        "damaged order ORD-2024-7891.\n\n"
        "Could you please send us a photo of the damaged headphones? "
        "This will help us process your replacement quickly."
    )
    _mock_send_whatsapp(DEMO_CUSTOMER["phone"], wa_request_text)
    real_app.store_message(
        DEMO_CUSTOMER["id"], "whatsapp", "assistant", wa_request_text,
    )
    real_app.sse_publish("channel.whatsapp", {
        "direction": "outbound",
        "text": wa_request_text,
        "customer": DEMO_CUSTOMER,
        "customer_name": DEMO_CUSTOMER["name"],
    })
    time.sleep(3)

    # -----------------------------------------------------------------------
    # Step 3: Maria sends photo + description via WhatsApp (inbound WA)
    # -----------------------------------------------------------------------
    print("  [Step 3] Inbound WhatsApp — Maria sends damage photo...")
    real_app.sse_publish("journey.progress", {"step": 3})
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

    # Update order with damage photo
    real_app.update_order(DEMO_ORDER["id"], damage_photo_url="https://example.com/damage-photo-001.jpg")
    real_app.sse_publish("order.update", {
        "order": {
            **DEMO_ORDER,
            "customer_id": DEMO_CUSTOMER["id"],
            "status": "damage_reported",
            "damage_photo_url": "https://example.com/damage-photo-001.jpg",
            "replacement_tracking": None,
        },
    })
    time.sleep(3)

    # -----------------------------------------------------------------------
    # Step 4: Support confirms replacement via WhatsApp (outbound WA)
    # -----------------------------------------------------------------------
    print("  [Step 4] Outbound WhatsApp — replacement approved...")
    real_app.sse_publish("journey.progress", {"step": 4})
    time.sleep(0.5)

    wa_confirm_text = (
        "Thank you for the photo, Maria. We can clearly see the damage "
        "and have approved a replacement.\n\n"
        "A new pair of Wireless Noise-Cancelling Headphones will be "
        "shipped to you today. You'll receive a shipping confirmation "
        "email shortly with tracking details."
    )
    _mock_send_whatsapp(DEMO_CUSTOMER["phone"], wa_confirm_text)
    real_app.store_message(
        DEMO_CUSTOMER["id"], "whatsapp", "assistant", wa_confirm_text,
    )
    real_app.sse_publish("channel.whatsapp", {
        "direction": "outbound",
        "text": wa_confirm_text,
        "customer": DEMO_CUSTOMER,
        "customer_name": DEMO_CUSTOMER["name"],
    })

    # Update order status
    real_app.update_order(DEMO_ORDER["id"], status="replacement_shipping")
    real_app.sse_publish("order.update", {
        "order": {
            **DEMO_ORDER,
            "customer_id": DEMO_CUSTOMER["id"],
            "status": "replacement_shipping",
            "damage_photo_url": "https://example.com/damage-photo-001.jpg",
            "replacement_tracking": None,
        },
    })
    time.sleep(3)

    # -----------------------------------------------------------------------
    # Step 5: Shipping confirmation email (outbound email)
    # -----------------------------------------------------------------------
    print("  [Step 5] Outbound email — shipping confirmation...")
    real_app.sse_publish("journey.progress", {"step": 5})
    time.sleep(0.5)

    ship_subject = "Replacement Shipped — ORD-2024-7891"
    ship_body = (
        "Dear Maria,\n\n"
        "Great news! Your replacement Wireless Noise-Cancelling Headphones "
        "have been shipped.\n\n"
        "Replacement Tracking: 1Z999AA10987654321\n"
        "Estimated Delivery: 2-3 business days\n\n"
        "No need to return the damaged pair — you can recycle or dispose "
        "of it at your convenience.\n\n"
        "Reference: SR-2024-0456\n\n"
        "Thank you for your patience, and we apologize for the inconvenience.\n\n"
        "Best regards,\n"
        "TelnyxDemo Corp Support"
    )
    _mock_send_email(DEMO_CUSTOMER["email"], ship_subject, ship_body)
    real_app.store_message(
        DEMO_CUSTOMER["id"], "email", "assistant",
        f"Subject: {ship_subject}\n{ship_body}",
    )
    real_app.sse_publish("channel.email", {
        "direction": "outbound",
        "from": "support@telnyxdemo.com",
        "subject": ship_subject,
        "body": ship_body,
        "customer": DEMO_CUSTOMER,
    })

    # Final order update
    real_app.update_order(
        DEMO_ORDER["id"],
        status="resolved",
        replacement_tracking="1Z999AA10987654321",
    )
    real_app.sse_publish("order.update", {
        "order": {
            **DEMO_ORDER,
            "customer_id": DEMO_CUSTOMER["id"],
            "status": "resolved",
            "damage_photo_url": "https://example.com/damage-photo-001.jpg",
            "replacement_tracking": "1Z999AA10987654321",
        },
    })
    time.sleep(2)

    # Journey complete
    real_app.sse_publish("journey.complete", {
        "summary": (
            "Journey complete! Damaged-order support across Email & WhatsApp:\n\n"
            "1. Email in  - Maria reported damaged headphones\n"
            "2. Email out - Auto-acknowledgment, mentioned WhatsApp follow-up\n"
            "3. WA out    - Requested damage photo\n"
            "4. WA in     - Maria sent photo + description\n"
            "5. WA out    - Confirmed replacement approved\n"
            "6. Email out - Shipping confirmation with tracking\n\n"
            "Order status: delivered -> damage_reported -> replacement_shipping -> resolved"
        ),
    })
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
