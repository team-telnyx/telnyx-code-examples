import os
import logging
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import telnyx

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("true", "1", "yes")

if TELNYX_API_KEY:
    telnyx.aio.init(api_key=TELNYX_API_KEY)

# In-memory semantic cache for demo purposes.
# In production, replace with Redis, SQLite, or a vector database.
_cache = {}


def _cache_key(prompt: str) -> str:
    return prompt.strip().lower()


def _semantic_lookup(prompt: str):
    """Return cached response if a semantically similar prompt exists."""
    key = _cache_key(prompt)
    return _cache.get(key)


def _semantic_store(prompt: str, response: str):
    """Store a prompt/response pair in the cache."""
    key = _cache_key(prompt)
    _cache[key] = response


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "demo_mode": DEMO_MODE}), 200


@app.route("/semantic-cache", methods=["POST"])
def semantic_cache():
    """
    Semantic cache endpoint.

    Accepts a JSON body:
    {
        "prompt": "user's question or prompt text"
    }

    Returns:
    {
        "response": "cached or generated response",
        "cached": true/false,
        "demo_mode": true/false
    }
    """
    try:
        body = request.get_json(silent=True)
        if not body or "prompt" not in body:
            return jsonify({"error": "Missing 'prompt' in request body"}), 400

        prompt = body["prompt"]

        # Check the semantic cache first
        cached = _semantic_lookup(prompt)
        if cached is not None:
            app.logger.info("Cache hit for prompt: %s", prompt[:50])
            return jsonify({
                "response": cached,
                "cached": True,
                "demo_mode": DEMO_MODE
            }), 200

        # Cache miss — generate a response
        if DEMO_MODE:
            # In demo mode, we simulate an LLM response without making real API calls
            response_text = f"[Demo] Response to: {prompt}"
        else:
            # In live mode, you would call your LLM provider here.
            # This is a placeholder for integration with OpenAI, Anthropic, etc.
            response_text = f"[Live] Response to: {prompt}"

        # Store in cache for future lookups
        _semantic_store(prompt, response_text)

        return jsonify({
            "response": response_text,
            "cached": False,
            "demo_mode": DEMO_MODE
        }), 200

    except Exception as e:
        app.logger.exception("Error processing semantic cache request")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/webhook", methods=["POST"])
def webhook():
    """
    Telnyx webhook handler.

    Verifies the Ed25519 signature and processes incoming events.
    """
    try:
        # Verify the webhook signature
        signature = request.headers.get("Telnyx-Signature-Ed25519", "")
        nonce = request.headers.get("Telnyx-Signature-Timestamp", "")

        if not signature or not nonce:
            return jsonify({"error": "Missing signature headers"}), 400

        # Unwrap and verify the webhook
        try:
            webhook_data = telnyx.Webhook.construct_event(
                payload=request.get_data(),
                signature=signature,
                timestamp=nonce,
                tolerance=300,
            )
        except Exception as sig_error:
            app.logger.exception("Webhook signature verification failed")
            return jsonify({"error": "Invalid signature"}), 403

        event_type = webhook_data["type"]
        data = webhook_data["data"]
        payload = data.get("payload", {})

        app.logger.info("Received Telnyx event: %s", event_type)

        # Handle different event types
        if event_type == "message.received":
            from_number = payload.get("from", {}).get("phone_number", "")
            to_number = payload.get("to", [{}])[0].get("phone_number", "")
            text = payload.get("text", "")

            app.logger.info(
                "Message received from %s to %s: %s",
                from_number, to_number, text
            )

            if DEMO_MODE:
                app.logger.info(
                    "[Demo] Would send reply to %s: Acknowledged your message.",
                    from_number
                )
            else:
                # In live mode, send a real SMS reply
                try:
                    telnyx.Message.create(
                        from_=TELNYX_PHONE_NUMBER,
                        to=from_number,
                        text="Acknowledged your message."
                    )
                except Exception as send_error:
                    app.logger.exception("Failed to send SMS reply")

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        app.logger.exception("Error processing webhook")
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
