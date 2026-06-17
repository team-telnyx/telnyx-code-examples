#!/usr/bin/env python3
"""Production-ready Flask webhook endpoint for receiving inbound SMS via Telnyx."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def process_inbound_sms(event_data: dict) -> dict:
    """
    Extract and validate inbound SMS data from webhook event.
    
    Args:
        event_data: The 'data' object from the webhook payload.
    
    Returns:
        Dictionary with extracted message details.
    """
    # Extract message attributes from the webhook event
    message_id = event_data.get("id")
    from_number = event_data.get("from", {}).get("phone_number")
    to_number = event_data.get("to", [{}])[0].get("phone_number")
    text = event_data.get("text", "")
    received_at = event_data.get("received_at")
    
    # Return JSON-serializable data
    return {
        "message_id": message_id,
        "from": from_number,
        "to": to_number,
        "text": text,
        "received_at": received_at,
    }


@app.route("/webhooks/sms", methods=["POST"])
def receive_sms_webhook():
    """
    Webhook endpoint to receive inbound SMS from Telnyx.
    
    Telnyx sends a POST request with event type 'message.received' for inbound SMS.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "Empty request body"}), 400
    
    # Extract event metadata
    event_type = payload.get("type")
    event_data = payload.get("data", {})
    
    # Only process inbound SMS events
    if event_type != "message.received":
        return jsonify({"status": "ignored", "reason": f"Event type {event_type} not processed"}), 200
    
    try:
        # Process the inbound message
        message_info = process_inbound_sms(event_data)
        
        # Log or store the message (example: print to console)
        print(f"Received SMS: message_id={message_info['message_id']}")
        
        # Return 200 OK to acknowledge receipt to Telnyx
        return jsonify({
            "status": "received",
            "message_id": message_info["message_id"],
        }), 200
        
    except Exception as e:
        # Log the error but still return 200 to prevent Telnyx retries
        print(f"Error processing webhook: {str(e)}")
        return jsonify({"status": "error"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
