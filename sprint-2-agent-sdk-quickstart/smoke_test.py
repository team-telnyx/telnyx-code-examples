"""Local smoke tests for the SMS triage application."""

import base64
import json
import time
import unittest

from nacl.signing import SigningKey

import app as sample_app


def signed_headers(signing_key: SigningKey, body: bytes) -> dict[str, str]:
    timestamp = str(int(time.time()))
    signature = signing_key.sign(timestamp.encode() + b"|" + body).signature
    return {
        "Telnyx-Timestamp": timestamp,
        "Telnyx-Signature-Ed25519": base64.b64encode(signature).decode(),
        "Content-Type": "application/json",
    }


class SmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        sample_app.CONVERSATIONS.clear()
        self.client = sample_app.app.test_client()

    def test_health(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_dashboard(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"No conversations yet", response.data)

    def test_signed_webhook_and_invalid_signature_rejection(self) -> None:
        signing_key = SigningKey.generate()
        sample_app.TELNYX_PUBLIC_KEY = base64.b64encode(
            bytes(signing_key.verify_key)
        ).decode()
        sent_messages = []
        sample_app._send_sms = lambda to, body: sent_messages.append((to, body))

        event = {
            "data": {
                "event_type": "message.received",
                "payload": {
                    "from": [{"phone_number": "+15550000002"}],
                    "to": [{"phone_number": "+15550000001"}],
                    "text": "Printer offline",
                },
            }
        }
        body = json.dumps(event, separators=(",", ":")).encode()
        response = self.client.post(
            "/webhooks/sms", data=body, headers=signed_headers(signing_key, body)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})
        self.assertEqual(len(sent_messages), 1)

        rejected = self.client.post(
            "/webhooks/sms", data=body, content_type="application/json"
        )
        self.assertEqual(rejected.status_code, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
