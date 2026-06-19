#!/usr/bin/env python3
"""Production-ready Flask application for shortcode SMS with Telnyx."""

import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern.
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)

TELNYX_SHORTCODE = os.getenv("TELNYX_SHORTCODE")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

# In-memory storage for received messages (use a database in production)
received_messages = []


def send_shortcode_sms(to_number: str, message: str) -> dict:
    """Send SMS via shortcode and return JSON-serializable response data."""
    if not TELNYX_SHORTCODE:
        raise ValueError("TELNYX_SHORTCODE environment variable not set")
    
    # Validate E.164 format to prevent API errors
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Validate message length (SMS segments are 160 chars for standard, 153 for Unicode)
    if len(message) == 0:
        raise ValueError("Message cannot be empty")
    if len(message) > 1600:
        raise ValueError("Message exceeds maximum length (1600 characters)")
    
    # Send message using shortcode as from_number
    response = client.messages.create(
        from_=TELNYX_SHORTCODE,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "queued",
        "from": TELNYX_SHORTCODE,
        "to": to_number,
        "segments": response.data.parts if hasattr(response.data, "parts") else 1,
    }


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send SMS via shortcode."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_shortcode_sms(to_number, message)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/webhooks/sms", methods=["POST"])
def handle_inbound_sms():
    """Webhook endpoint to receive inbound SMS messages."""
    # Verify the Telnyx Ed25519 signature against the raw body before trusting
    # anything. unwrap() reads the telnyx-signature-ed25519 / telnyx-timestamp
    # headers and raises if the signature or timestamp (replay) check fails.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    try:
        body = request.get_json(silent=True)

        if not body:
            return jsonify({"error": "No payload received"}), 400

        # event_type lives at the data level; the event fields are nested under
        # data.payload (the message object for Messaging webhooks).
        data = body.get("data", {})
        event_type = data.get("event_type")
        payload = data.get("payload", {})

        if event_type == "message.received":
            # Extract message details from the nested payload object.
            to_list = payload.get("to") or [{}]
            inbound_message = {
                "id": payload.get("id"),
                "from": (payload.get("from") or {}).get("phone_number"),
                "to": to_list[0].get("phone_number"),
                "text": payload.get("text"),
                "received_at": payload.get("received_at"),
                "direction": payload.get("direction"),
            }

            # Store message (in production, save to database)
            received_messages.append(inbound_message)

            # Log for debugging
            print(f"Inbound SMS: {inbound_message['from']} -> {inbound_message['to']}: {inbound_message['text']}")

            return jsonify({"status": "received"}), 200

        elif event_type == "message.finalized":
            # Handle delivery status updates
            to_list = payload.get("to") or [{}]
            status = to_list[0].get("status")
            message_id = payload.get("id")

            print(f"Message {message_id} status: {status}")

            return jsonify({"status": "processed"}), 200

        else:
            # Acknowledge other event types
            return jsonify({"status": "acknowledged"}), 200

    except Exception:
        # Log full detail server-side; never leak exception text to callers.
        app.logger.exception("Webhook processing error")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages/received", methods=["GET"])
def list_received_messages():
    """Retrieve all received inbound messages."""
    return jsonify(received_messages), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy", "timestamp": datetime.utcnow().isoformat()}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
