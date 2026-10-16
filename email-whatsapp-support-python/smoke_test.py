"""Smoke tests for the Email & WhatsApp customer support demo.

Run:
    python smoke_test.py
"""

import json
import os
import sqlite3
import sys
import unittest

# Set up demo environment before importing app
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
os.environ["TELNYX_API_KEY"] = "test_key"
os.environ["TELNYX_EMAIL_FROM"] = "test@example.com"
os.environ["WHATSAPP_NUMBER"] = "+15550009999"
os.environ["MESSAGING_PROFILE_ID"] = "test_profile"
os.environ["DB_PATH"] = os.path.join(_PROJECT_ROOT, "test_support.db")
os.environ["PORT"] = "5099"
os.environ["DEMO_MODE"] = "test"

# Clean test DB
_test_db = os.environ["DB_PATH"]
if os.path.exists(_test_db):
    os.remove(_test_db)

import app as real_app  # noqa: E402
from app import app  # noqa: E402

real_app.init_db()

# Patch call_inference so background threads don't hit real API
def _noop_call_inference(messages):
    return {"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "Test."}}]}

real_app.call_inference = _noop_call_inference


class TestImports(unittest.TestCase):
    """Verify core modules import correctly."""

    def test_app_imports(self):
        import app
        self.assertTrue(hasattr(app, "app"))
        self.assertTrue(hasattr(app, "init_db"))
        self.assertTrue(hasattr(app, "sse_publish"))
        self.assertTrue(hasattr(app, "call_inference"))
        self.assertTrue(hasattr(app, "mask_phone"))

    def test_demo_importable(self):
        # Just verify the demo module's path is valid
        demo_path = os.path.join(_PROJECT_ROOT, "demo", "demo_server.py")
        self.assertTrue(os.path.exists(demo_path))


class TestRoutes(unittest.TestCase):
    """Verify all API routes respond."""

    def setUp(self):
        self.client = app.test_client()

    def test_health(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "ok")

    def test_dashboard(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"TelnyxDemo", resp.data)

    def test_customers(self):
        resp = self.client.get("/customers")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.get_json(), list)

    def test_conversations(self):
        resp = self.client.get("/conversations")
        self.assertEqual(resp.status_code, 200)

    def test_orders(self):
        resp = self.client.get("/orders")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.get_json(), list)

    def test_orders_by_id_not_found(self):
        resp = self.client.get("/orders/NONEXISTENT")
        self.assertEqual(resp.status_code, 404)


class TestDatabase(unittest.TestCase):
    """Verify database operations."""

    def test_register_and_resolve_by_email(self):
        real_app.register_customer("test_1", "Test User", email="test1@example.com")
        customer = real_app.resolve_customer(email="test1@example.com")
        self.assertIsNotNone(customer)
        self.assertEqual(customer["name"], "Test User")

    def test_resolve_by_phone(self):
        real_app.register_customer("test_2", "Phone User", phone="+15559999999")
        customer = real_app.resolve_customer(phone="+15559999999")
        self.assertIsNotNone(customer)
        self.assertEqual(customer["name"], "Phone User")

    def test_resolve_unknown(self):
        customer = real_app.resolve_customer(email="nobody@nowhere.com")
        self.assertIsNone(customer)

    def test_store_and_get_history(self):
        real_app.store_message("test_1", "email", "user", "Hello")
        real_app.store_message("test_1", "whatsapp", "assistant", "Hi there")
        history = real_app.get_conversation_history("test_1")
        self.assertGreaterEqual(len(history), 2)
        channels = {msg["channel"] for msg in history}
        self.assertIn("email", channels)
        self.assertIn("whatsapp", channels)

    def test_order_crud(self):
        real_app.create_order("ORD-TEST-001", "test_1", "Widget", status="delivered")
        order = real_app.get_order("ORD-TEST-001")
        self.assertIsNotNone(order)
        self.assertEqual(order["product"], "Widget")
        self.assertEqual(order["status"], "delivered")

        real_app.update_order("ORD-TEST-001", status="damage_reported")
        order = real_app.get_order("ORD-TEST-001")
        self.assertEqual(order["status"], "damage_reported")

    def test_orders_for_customer(self):
        orders = real_app.get_orders_for_customer("test_1")
        self.assertIsInstance(orders, list)


class TestMaskPhone(unittest.TestCase):
    """Verify phone number masking."""

    def test_mask_normal_number(self):
        # +31626781895 is 12 chars: first 3 + 5 bullets + last 4
        self.assertEqual(real_app.mask_phone("+31626781895"), "+31\u2022\u2022\u2022\u2022\u20221895")

    def test_mask_short_number(self):
        self.assertEqual(real_app.mask_phone("+123"), "+123")

    def test_mask_none(self):
        self.assertIsNone(real_app.mask_phone(None))

    def test_mask_empty(self):
        self.assertEqual(real_app.mask_phone(""), "")

    def test_mask_us_number(self):
        result = real_app.mask_phone("+15551234567")
        self.assertTrue(result.startswith("+15"))
        self.assertTrue(result.endswith("4567"))
        self.assertIn("\u2022", result)


class TestWebhooks(unittest.TestCase):
    """Verify webhook handlers process payloads correctly."""

    def setUp(self):
        self.client = app.test_client()
        real_app.register_customer(
            "test_wh", "Webhook User",
            email="webhook@example.com",
            phone="+15558887777",
        )

    def test_email_webhook(self):
        resp = self.client.post("/webhooks/email", json={
            "data": {
                "event_type": "email.received",
                "payload": {
                    "from": {"email": "webhook@example.com"},
                    "subject": "Test Subject",
                    "body": "Test body content",
                },
            },
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "processing")

    def test_email_webhook_unknown_customer(self):
        resp = self.client.post("/webhooks/email", json={
            "data": {
                "event_type": "email.received",
                "payload": {
                    "from": {"email": "unknown@example.com"},
                    "subject": "Test",
                    "body": "Test",
                },
            },
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "unknown_customer")

    def test_email_webhook_wrong_event(self):
        resp = self.client.post("/webhooks/email", json={
            "data": {
                "event_type": "email.sent",
                "payload": {},
            },
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "ignored")

    def test_whatsapp_webhook(self):
        resp = self.client.post("/webhooks/whatsapp", json={
            "data": {
                "event_type": "message.received",
                "payload": {
                    "direction": "inbound",
                    "from": {"phone_number": "+15558887777"},
                    "body": {
                        "type": "text",
                        "text": {"body": "Hello from WhatsApp"},
                    },
                },
            },
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "processing")

    def test_whatsapp_webhook_with_media(self):
        resp = self.client.post("/webhooks/whatsapp", json={
            "data": {
                "event_type": "message.received",
                "payload": {
                    "direction": "inbound",
                    "from": {"phone_number": "+15558887777"},
                    "body": {
                        "type": "image",
                        "image": {
                            "url": "https://example.com/photo.jpg",
                            "caption": "Photo attached",
                        },
                    },
                },
            },
        })
        self.assertEqual(resp.status_code, 200)

    def test_whatsapp_webhook_outbound_ignored(self):
        resp = self.client.post("/webhooks/whatsapp", json={
            "data": {
                "event_type": "message.received",
                "payload": {
                    "direction": "outbound",
                    "from": {"phone_number": "+15558887777"},
                    "body": {
                        "type": "text",
                        "text": {"body": "Outbound"},
                    },
                },
            },
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "ignored")

    def test_no_payload(self):
        resp = self.client.post("/webhooks/email",
                                data="",
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)


class TestDemoJourney(unittest.TestCase):
    """Verify the demo journey runs end-to-end."""

    def test_full_journey(self):
        """Run the demo journey steps manually and verify DB state."""
        # Register customer and order
        real_app.register_customer(
            "cust_journey", "Journey User",
            email="journey@example.com",
            phone="+15551112222",
        )
        real_app.create_order(
            "ORD-JOURNEY-001", "cust_journey",
            "Test Product", status="delivered",
        )

        # Simulate inbound email
        client = app.test_client()
        client.post("/webhooks/email", json={
            "data": {
                "event_type": "email.received",
                "payload": {
                    "from": {"email": "journey@example.com"},
                    "subject": "Damaged order",
                    "body": "My order arrived damaged.",
                },
            },
        })

        # Verify message stored
        history = real_app.get_conversation_history("cust_journey")
        self.assertTrue(len(history) >= 1)
        self.assertEqual(history[0]["channel"], "email")

        # Simulate inbound WhatsApp
        client.post("/webhooks/whatsapp", json={
            "data": {
                "event_type": "message.received",
                "payload": {
                    "direction": "inbound",
                    "from": {"phone_number": "+15551112222"},
                    "body": {
                        "type": "image",
                        "image": {
                            "url": "https://example.com/photo.jpg",
                            "caption": "Here is the damage photo",
                        },
                    },
                },
            },
        })

        history = real_app.get_conversation_history("cust_journey")
        channels = {msg["channel"] for msg in history}
        self.assertIn("email", channels)
        self.assertIn("whatsapp", channels)

        # Verify order operations
        real_app.update_order("ORD-JOURNEY-001", status="resolved")
        order = real_app.get_order("ORD-JOURNEY-001")
        self.assertEqual(order["status"], "resolved")


if __name__ == "__main__":
    unittest.main(verbosity=2)
