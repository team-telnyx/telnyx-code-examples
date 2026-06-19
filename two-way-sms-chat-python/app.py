#!/usr/bin/env python3
"""Production-ready Flask application for two-way SMS with Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Simple in-memory storage for conversation state
conversations = {}


def send_sms(to_number: str, message: str) -> dict:
    """Send SMS via Telnyx and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format")
    
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "text": message,
    }


def process_inbound_message(from_number: str, message_text: str) -> str:
    """Process inbound SMS and generate appropriate response."""
    message_lower = message_text.lower().strip()
    
    # Initialize conversation state if new user
    if from_number not in conversations:
        conversations[from_number] = {
            "state": "new",
            "created_at": datetime.now(),
            "message_count": 0
        }
    
    conversation = conversations[from_number]
    conversation["message_count"] += 1
    conversation["last_message"] = datetime.now()
    
    # Simple conversation flow based on keywords
    if message_lower in ["hello", "hi", "hey", "start"]:
        conversation["state"] = "greeted"
        return "Hello! Welcome to Telnyx SMS. Type 'help' for available commands or 'info' to learn more about our services."
    
    elif message_lower == "help":
        return "Available commands:\n• 'info' - Learn about Telnyx\n• 'status' - Check your conversation stats\n• 'reset' - Start over\n• 'stop' - End conversation"
    
    elif message_lower == "info":
        conversation["state"] = "informed"
        return "Telnyx provides programmable SMS, Voice, and IoT connectivity APIs. Visit telnyx.com to get started with our developer-friendly platform!"
    
    elif message_lower == "status":
        return f"Conversation started: {conversation['created_at'].strftime('%Y-%m-%d %H:%M')}\nMessages exchanged: {conversation['message_count']}\nCurrent state: {conversation['state']}"
    
    elif message_lower == "reset":
        conversations[from_number] = {
            "state": "reset",
            "created_at": datetime.now(),
            "message_count": 1
        }
        return "Conversation reset! Type 'hello' to start fresh."
    
    elif message_lower in ["stop", "quit", "end"]:
        conversation["state"] = "ended"
        return "Thanks for trying Telnyx SMS! Conversation ended. Text 'hello' anytime to start again."
    
    else:
        # Echo back with helpful suggestion
        return f"You said: '{message_text}'\n\nI didn't understand that command. Type 'help' to see available options."


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    """Handle inbound SMS webhooks from Telnyx."""
    try:
        webhook_data = request.get_json()
        
        if not webhook_data:
            return jsonify({"error": "No webhook data received"}), 400
        
        # Extract message details from webhook payload
        event_type = webhook_data.get("data", {}).get("event_type")
        
        if event_type != "message.received":
            # Acknowledge other events but don't process
            return jsonify({"status": "acknowledged"}), 200
        
        payload = webhook_data.get("data", {}).get("payload", {})
        from_number = payload.get("from", {}).get("phone_number")
        to_number = payload.get("to", [{}])[0].get("phone_number")
        message_text = payload.get("text")
        
        if not all([from_number, to_number, message_text]):
            return jsonify({"error": "Missing required message fields"}), 400
        
        # Process the inbound message and generate response
        response_text = process_inbound_message(from_number, message_text)
        
        # Send the response back to the user
        send_result = send_sms(from_number, response_text)
        
        return jsonify({
            "status": "processed",
            "inbound_message": message_text,
            "response_sent": response_text,
            "message_id": send_result["message_id"]
        }), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Authentication failed"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send outbound SMS."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_sms(to_number, message)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/conversations", methods=["GET"])
def list_conversations():
    """List active conversations for debugging."""
    return jsonify([
        {
            "phone_number": phone,
            "state": conv["state"],
            "message_count": conv["message_count"],
            "created_at": conv["created_at"].isoformat(),
        }
        for phone, conv in conversations.items()
    ]), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
