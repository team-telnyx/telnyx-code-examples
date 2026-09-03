```python
import os
import logging
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import telnyx

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER", "")
TTS_VOICE = os.getenv("TTS_VOICE", "male")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "en-US")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("true", "1", "yes")

telnyx_client = telnyx.Core(TELNYX_API_KEY) if TELNYX_API_KEY else None


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "demo_mode": DEMO_MODE}), 200


@app.route("/publish", methods=["POST"])
def publish_article():
    """
    Accepts an article (text) and publishes it as audio via Telnyx TTS.
    In demo mode, logs the action without making real API calls.
    """
    try:
        data = request.get_json(silent=True) or {}
        article_text = data.get("article_text", "")
        destination_number = data.get("destination_number", TELNYX_PHONE_NUMBER)

        if not article_text:
            return jsonify({"error": "article_text is required"}), 400

        if not destination_number:
            return jsonify({"error": "destination_number is required"}), 400

        if DEMO_MODE:
            app.logger.info(
                "DEMO MODE: Would publish article as audio to %s using voice=%s, language=%s",
                destination_number,
                TTS_VOICE,
                TTS_LANGUAGE,
            )
            return jsonify({
                "status": "demo",
                "message": "Article audio published (demo mode)",
                "destination_number": destination_number,
                "voice": TTS_VOICE,
                "language": TTS_LANGUAGE,
                "article_length": len(article_text),
            }), 200

        if not telnyx_client:
            return jsonify({"error": "Telnyx API key not configured"}), 500

        # Use Telnyx TTS to convert article text to speech and send via SIP call
        # The Telnyx SDK supports TTS through the Calls API with 'record' and 'voice' params
        call = telnyx.Calls.create(
            from_=TELNYX_PHONE_NUMBER,
            to=destination_number,
            voice=TTS_VOICE,
            language=TTS_LANGUAGE,
            # Use the article text as the content to be spoken
            # Telnyx TTS reads the text aloud during the call
            text=article_text,
            webhook_url=os.getenv("TELNYX_WEBHOOK_URL", ""),
        )

        return jsonify({
            "status": "published",
            "call_id": call.id,
            "message": "Article audio published via Telnyx TTS",
            "destination_number": destination_number,
        }), 200

    except Exception:
        app.logger.exception("Failed to publish article audio")
        return jsonify({"error": "An internal error occurred"}), 500


@app.route("/webhook", methods=["POST"])
def webhook():
    """
    Handles inbound Telnyx webhooks.
    Verifies the Ed25519 signature and processes the event.
    """
    try:
        if not telnyx_client:
            return jsonify({"error": "Telnyx API key not configured"}), 500

        # Verify webhook signature using Telnyx SDK
        try:
            event = telnyx.Webhooks.unwrap(
                request.get_data(),
                request.headers.get("Telnyx-Signature"),
                request.headers.get("Telnyx-Timestamp"),
            )
        except Exception:
            app.logger.exception("Webhook signature verification failed")
            return jsonify({"error": "Invalid signature"}), 401

        event_type = event.get("data", {}).get("event_type", "unknown")
        payload = event.get("data", {}).get("payload", {})

        app.logger.info("Received Telnyx webhook event: %s", event_type)

        if event_type == "call.started":
            app.logger.info("Call started: %s", payload.get("call_id"))
        elif event_type == "call.answered":
            app.logger.info("Call answered: %s", payload.get("call_id"))
        elif event_type == "call.completed":
            app.logger.info("Call completed: %s", payload.get("call_id"))
        elif event_type == "call.recording.created":
            app.logger.info("Recording created: %s", payload.get("call_id"))

        return jsonify({"status": "ok"}), 200

    except Exception:
        app.logger.exception("Error processing webhook")
        return jsonify({"error": "An internal error occurred"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
```
