"""Smoke tests for the RCS Capability Campaign Desk.

Run:
    python smoke_test.py
"""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Set test environment before importing app
os.environ["TELNYX_API_KEY"] = "test_key"
os.environ["RCS_AGENT_ID"] = "test_agent"
os.environ["MESSAGING_PROFILE_ID"] = "test_profile"
os.environ["BOT_NUMBER"] = "+15550009999"
os.environ["PORT"] = "5099"

from app import app, decide_format  # noqa: E402


class TestDecideFormat(unittest.TestCase):
    """Unit tests for the decide_format() pure function — all 4 branches."""

    def test_landline_returns_sms_only(self):
        result = decide_format("landline", [])
        self.assertEqual(result["format"], "sms_only")
        self.assertEqual(result["tier"], "no_rcs")
        self.assertIn("landline", result["reason"])

    def test_voip_returns_sms_only(self):
        result = decide_format("voip", ["RICHCARD_STANDALONE"])
        self.assertEqual(result["format"], "sms_only")
        self.assertEqual(result["tier"], "no_rcs")
        self.assertIn("voip", result["reason"])

    def test_full_rcs_with_richcard(self):
        result = decide_format("mobile", ["RICHCARD_STANDALONE", "ACTION_DIAL"])
        self.assertEqual(result["format"], "rich_card_with_sms_fallback")
        self.assertEqual(result["tier"], "full_rcs")
        self.assertIn("rich card", result["reason"].lower())

    def test_basic_rcs_without_richcard(self):
        result = decide_format("mobile", ["ACTION_DIAL", "ACTION_VIEW_LOCATION"])
        self.assertEqual(result["format"], "plain_rcs_with_sms_fallback")
        self.assertEqual(result["tier"], "basic_rcs")
        self.assertIn("basic RCS", result["reason"])

    def test_no_rcs_empty_features(self):
        result = decide_format("mobile", [])
        self.assertEqual(result["format"], "sms_only")
        self.assertEqual(result["tier"], "no_rcs")
        self.assertIn("No RCS", result["reason"])

    def test_no_rcs_none_features(self):
        result = decide_format("unknown", None)
        self.assertEqual(result["format"], "sms_only")
        self.assertEqual(result["tier"], "no_rcs")


class TestRoutes(unittest.TestCase):
    """Test all API routes return expected status codes."""

    def setUp(self):
        self.client = app.test_client()

    def test_health(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("uptime_seconds", data)

    def test_dashboard(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"RCS Campaign Desk", resp.data)

    def test_check_capability_missing_phone(self):
        resp = self.client.post("/api/check-capability",
                                json={},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("phone", resp.get_json()["error"])

    @patch("app.http_requests.get")
    def test_check_capability_success(self, mock_get):
        # Mock Number Lookup response
        nl_response = MagicMock()
        nl_response.status_code = 200
        nl_response.json.return_value = {
            "data": {
                "carrier": {"name": "T-Mobile", "type": "mobile"},
                "country_code": "US",
            }
        }
        nl_response.raise_for_status = MagicMock()

        # Mock RCS Capabilities response
        rcs_response = MagicMock()
        rcs_response.status_code = 200
        rcs_response.json.return_value = {
            "data": {"features": ["RICHCARD_STANDALONE", "ACTION_DIAL"]}
        }
        rcs_response.raise_for_status = MagicMock()

        mock_get.side_effect = [nl_response, rcs_response]

        resp = self.client.post("/api/check-capability",
                                json={"phone": "+12125551234"},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["decision"]["tier"], "full_rcs")
        self.assertEqual(data["number_lookup"]["carrier"], "T-Mobile")

    def test_generate_content_missing_prompt(self):
        resp = self.client.post("/api/generate-content",
                                json={},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("prompt", resp.get_json()["error"])

    @patch("app.http_requests.post")
    def test_generate_content_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "title": "Flash Sale",
                        "description": "30% off all plans",
                        "button_text": "Shop Now",
                        "button_url": "https://example.com/sale",
                        "sms_fallback_text": "Flash Sale! 30% off all plans. Visit example.com/sale",
                    })
                }
            }]
        }
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        resp = self.client.post("/api/generate-content",
                                json={"prompt": "flash sale"},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["content"]["title"], "Flash Sale")

    def test_send_missing_phone(self):
        resp = self.client.post("/api/send",
                                json={"title": "Test"},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    def test_send_missing_content(self):
        resp = self.client.post("/api/send",
                                json={"phone": "+12125551234"},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    @patch("app.http_requests.post")
    @patch("app.http_requests.get")
    def test_send_sms_only_for_landline(self, mock_get, mock_post):
        # Number Lookup returns landline
        nl_resp = MagicMock()
        nl_resp.json.return_value = {
            "data": {"carrier": {"name": "AT&T", "type": "landline"}, "country_code": "US"}
        }
        nl_resp.raise_for_status = MagicMock()
        mock_get.return_value = nl_resp

        # SMS send response
        sms_resp = MagicMock()
        sms_resp.json.return_value = {"data": {"id": "msg_123"}}
        sms_resp.raise_for_status = MagicMock()
        mock_post.return_value = sms_resp

        resp = self.client.post("/api/send", json={
            "phone": "+12125551234",
            "title": "Test",
            "sms_fallback_text": "Test SMS",
        }, content_type="application/json")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["decision"]["format"], "sms_only")
        self.assertEqual(data["results"][0]["channel"], "sms")

    def test_generate_deeplink_missing_body(self):
        resp = self.client.post("/api/generate-deeplink",
                                json={},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    @patch("app.http_requests.get")
    def test_generate_deeplink_success(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": {"deeplink_url": "https://rcs.telnyx.com/dl/abc123"}
        }
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        resp = self.client.post("/api/generate-deeplink",
                                json={"body": "Hello"},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["deeplink"], "https://rcs.telnyx.com/dl/abc123")


if __name__ == "__main__":
    unittest.main(verbosity=2)
