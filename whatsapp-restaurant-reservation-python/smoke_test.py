"""
Smoke tests for the WhatsApp Restaurant Reservation app.

All HTTP calls are mocked — no real credentials needed.
Run: python smoke_test.py
"""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

# Set test env vars before importing app
os.environ["TELNYX_API_KEY"] = "KEYtest-main"
os.environ["TELNYX_WHATSAPP_API_KEY"] = "KEYtest-whatsapp"
os.environ["WHATSAPP_NUMBER"] = "+12176180378"
os.environ["WHATSAPP_MESSAGING_PROFILE_ID"] = "test-profile-id"

# Use temp DB for tests
_test_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DB_PATH"] = _test_db.name
_test_db.close()

import app as main_app


class TestHealth(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        self.client = main_app.app.test_client()
        main_app.init_db()

    def test_health(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("timestamp", data)
        self.assertEqual(data["whatsapp_number"], "+12176180378")

    def test_dashboard(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Ristorante AI", resp.data)


class TestRestaurants(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        self.client = main_app.app.test_client()
        main_app.init_db()
        # Seed fallback restaurants
        main_app.seed_restaurants()

    def test_list_restaurants(self):
        resp = self.client.get("/api/restaurants")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("restaurants", data)
        self.assertIn("total", data)
        self.assertIn("page", data)
        self.assertIn("total_pages", data)
        self.assertIsInstance(data["restaurants"], list)
        self.assertGreater(len(data["restaurants"]), 0)

    def test_search_restaurants(self):
        resp = self.client.get("/api/restaurants?q=Kas")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIsInstance(data["restaurants"], list)
        # Should find De Kas
        names = [r["name"] for r in data["restaurants"]]
        self.assertTrue(any("Kas" in n for n in names))

    @patch("app.fetch_google_restaurants")
    def test_refresh_restaurants(self, mock_google):
        mock_google.return_value = []  # Falls back to fallback data
        resp = self.client.post("/api/restaurants/refresh")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "refreshed")


class TestReservations(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        self.client = main_app.app.test_client()
        main_app.init_db()
        main_app.seed_restaurants()

    def test_list_reservations_empty(self):
        resp = self.client.get("/api/reservations")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("reservations", data)
        self.assertIsInstance(data["reservations"], list)

    def test_make_and_get_reservation(self):
        reservation = main_app.make_reservation(
            restaurant_id="fallback-1",
            customer_phone="+31612345678",
            customer_name="Test User",
            party_size=4,
            date_str="2026-10-20",
            time_str="19:00",
            notes="Window seat please",
        )
        self.assertIn("id", reservation)
        self.assertEqual(reservation["status"], "confirmed")

        resp = self.client.get("/api/reservations?date=2026-10-20")
        data = resp.get_json()
        self.assertGreater(len(data["reservations"]), 0)

    def test_update_reservation_status(self):
        reservation = main_app.make_reservation(
            restaurant_id="fallback-2",
            customer_phone="+31612345679",
            customer_name="Another User",
            party_size=2,
            date_str="2026-10-20",
            time_str="20:00",
        )
        res_id = reservation["id"]

        resp = self.client.patch(
            f"/api/reservations/{res_id}",
            data=json.dumps({"status": "cancelled"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "cancelled")

    def test_update_reservation_invalid_status(self):
        reservation = main_app.make_reservation(
            restaurant_id="fallback-3",
            customer_phone="+31612345680",
            customer_name="Bad Status",
            party_size=2,
            date_str="2026-10-20",
            time_str="18:00",
        )
        resp = self.client.patch(
            f"/api/reservations/{reservation['id']}",
            data=json.dumps({"status": "invalid"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)


class TestAvailability(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        main_app.init_db()
        main_app.seed_restaurants()

    def test_check_availability(self):
        slots = main_app.check_availability("fallback-1", "2026-10-25", 4)
        self.assertIsInstance(slots, list)
        self.assertGreater(len(slots), 0)
        # All standard slots should be available for a fresh date
        for slot in ["17:30", "18:00", "19:00", "20:00"]:
            self.assertIn(slot, slots)


class TestSearchRestaurants(unittest.TestCase):
    def setUp(self):
        main_app.init_db()
        main_app.seed_restaurants()

    def test_search_by_name(self):
        results = main_app.search_restaurants("Kas")
        self.assertGreater(len(results), 0)
        self.assertTrue(any("Kas" in r["name"] for r in results))

    def test_search_by_cuisine(self):
        results = main_app.search_restaurants("seafood")
        self.assertIsInstance(results, list)

    def test_search_no_results(self):
        results = main_app.search_restaurants("nonexistentzzz")
        self.assertEqual(len(results), 0)


class TestWebhook(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        self.client = main_app.app.test_client()
        main_app.init_db()
        main_app.seed_restaurants()
        # Reset dedup state between tests
        main_app._processed_msg_ids.clear()
        main_app._phone_cooldown.clear()

    def test_webhook_ignores_non_message(self):
        resp = self.client.post(
            "/webhooks/whatsapp",
            data=json.dumps({
                "data": {"event_type": "message.sent", "payload": {}}
            }),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "ignored")

    def test_webhook_ignores_outbound(self):
        resp = self.client.post(
            "/webhooks/whatsapp",
            data=json.dumps({
                "data": {
                    "event_type": "message.received",
                    "payload": {"direction": "outbound"},
                }
            }),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "ignored")

    @patch("app.process_inbound_whatsapp")
    def test_webhook_processes_text(self, mock_process):
        resp = self.client.post(
            "/webhooks/whatsapp",
            data=json.dumps({
                "data": {
                    "event_type": "message.received",
                    "payload": {
                        "direction": "inbound",
                        "from": {"phone_number": "+31612345678"},
                        "body": {
                            "type": "text",
                            "text": {"body": "Book a table at De Kas"},
                        },
                    },
                }
            }),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "processing")

    @patch("app.process_inbound_whatsapp")
    def test_webhook_processes_button_reply(self, mock_process):
        resp = self.client.post(
            "/webhooks/whatsapp",
            data=json.dumps({
                "data": {
                    "event_type": "message.received",
                    "payload": {
                        "direction": "inbound",
                        "from": {"phone_number": "+31612345678"},
                        "body": {
                            "type": "interactive",
                            "interactive": {
                                "type": "button_reply",
                                "button_reply": {"id": "confirm", "title": "Confirm"},
                            },
                        },
                    },
                }
            }),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)

    def test_webhook_no_payload(self):
        resp = self.client.post("/webhooks/whatsapp", data="", content_type="application/json")
        self.assertEqual(resp.status_code, 400)


class TestConversationHistory(unittest.TestCase):
    def setUp(self):
        main_app.init_db()

    def test_store_and_retrieve(self):
        main_app.store_message("+31600000000", "user", "Hello")
        main_app.store_message("+31600000000", "assistant", "Hi there!")
        history = main_app.get_conversation_history("+31600000000")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["role"], "user")
        self.assertEqual(history[1]["role"], "assistant")


class TestSSE(unittest.TestCase):
    def setUp(self):
        main_app.app.testing = True
        self.client = main_app.app.test_client()

    def test_sse_endpoint_returns_stream(self):
        resp = self.client.get("/stream")
        self.assertTrue(resp.content_type.startswith("text/event-stream"))


if __name__ == "__main__":
    unittest.main()
