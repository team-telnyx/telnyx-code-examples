#!/usr/bin/env python3
"""Production-ready SMS autoresponder using Telnyx webhooks."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import re
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def generate_response(incoming_message: str, sender_number: str) -> str:
    """Generate contextual response based on incoming message content."""
    message_lower = incoming_message.lower().strip()
    
    # Business hours check
    current_hour = datetime.now().hour
    is_business_hours = 9 <= current_hour <= 17
    
    # Keyword-based responses
    if any(word in message_lower for word in ['help', 'support', 'assistance']):
        if is_business_hours:
            return "Hi! Our support team is available now. Please call (555) 123-4567 or visit our website for immediate assistance."
        else:
            return "Thanks for reaching out! Our support hours are 9 AM - 5 PM. We'll respond first thing tomorrow morning."
    
    elif any(word in message_lower for word in ['hours', 'open', 'closed']):
        return "We're open Monday-Friday 9 AM to 5 PM EST. Weekend hours: Saturday 10 AM - 2 PM. Closed Sundays."
    
    elif any(word in message_lower for word in ['price', 'cost', 'pricing', 'quote']):
        return "Thanks for your interest in our pricing! Please visit our website or call (555) 123-4567 to speak with our sales team for a custom quote."
    
    elif any(word in message_lower for word in ['location', 'address', 'where']):
        return "We're located at 123 Main Street, Anytown, ST 12345. Free parking available. Need directions? Check our website!"
    
    elif message_lower in ['stop', 'unsubscribe', 'opt out']:
        return "You've been unsubscribed from our messages. Reply START to opt back in. Thanks!"
    
    elif message_lower in ['start', 'subscribe', 'opt in']:
        return "Welcome! You're now subscribed to our updates. Reply STOP anytime to unsubscribe."
    
    else:
        # Default response for unrecognized messages
        if is_business_hours:
            return "Thanks for your message! A team member will respond shortly. For immediate help, call (555) 123-4567."
        else:
            return "Thanks for contacting us! We'll respond during business hours (9 AM - 5 PM EST). For urgent matters, visit our website."


def send_auto_reply(to_number: str, message: str) -> dict:
    """Send automated SMS reply and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "text": message,
    }


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    """Process incoming SMS webhooks and send automated replies."""
    try:
        webhook_data = request.get_json()
        
        if not webhook_data:
            return jsonify({"error": "No webhook data received"}), 400
        
        # Extract event data
        event_type = webhook_data.get("data", {}).get("event_type")
        
        # Only process incoming messages
        if event_type != "message.received":
            return jsonify({"message": "Event ignored"}), 200
        
        payload = webhook_data.get("data", {}).get("payload", {})
        
        # Extract message details
        from_number = payload.get("from", {}).get("phone_number")
        to_number = payload.get("to", [{}])[0].get("phone_number")
        message_text = payload.get("text", "")
        
        if not from_number or not message_text:
            return jsonify({"error": "Missing required message data"}), 400
        
        # Generate and send automated response
        response_text = generate_response(message_text, from_number)
        reply_result = send_auto_reply(from_number, response_text)
        
        return jsonify({
            "status": "success",
            "original_message": message_text,
            "response_sent": response_text,
            "reply_id": reply_result["message_id"]
        }), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": str(e)}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy", "service": "sms-autoresponder"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
