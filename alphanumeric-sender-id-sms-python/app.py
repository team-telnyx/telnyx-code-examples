#!/usr/bin/env python3
"""Production-ready Flask application for sending SMS with alphanumeric sender IDs."""

import os
import re
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def validate_alphanumeric_sender_id(sender_id: str) -> bool:
    """Validate alphanumeric sender ID format (max 11 chars, alphanumeric only)."""
    if not sender_id or len(sender_id) > 11:
        return False
    # Allow letters, numbers, and spaces (some regions allow spaces)
    return bool(re.match(r"^[A-Za-z0-9\s]+$", sender_id))


def validate_recipient_number(to_number: str) -> bool:
    """Validate recipient phone number is in E.164 format."""
    return bool(to_number.startswith("+") and len(to_number) >= 10)


def send_sms_with_alphanumeric_id(
    to_number: str, message: str, sender_id: str = None
) -> dict:
    """
    Send SMS using alphanumeric sender ID.
    
    Args:
        to_number: Recipient phone number in E.164 format (e.g., +447700900123).
        message: SMS message text.
        sender_id: Alphanumeric sender ID (uses env default if not provided).
    
    Returns:
        Dictionary with message ID, status, and sender info.
    
    Raises:
        ValueError: If validation fails.
    """
    # Use provided sender_id or fall back to environment variable
    if sender_id is None:
        sender_id = os.getenv("ALPHANUMERIC_SENDER_ID")
    
    if not sender_id:
        raise ValueError("ALPHANUMERIC_SENDER_ID not configured")
    
    # Validate sender ID format
    if not validate_alphanumeric_sender_id(sender_id):
        raise ValueError(
            f"Invalid sender ID '{sender_id}'. Must be 1-11 alphanumeric characters."
        )
    
    # Validate recipient number
    if not validate_recipient_number(to_number):
        raise ValueError(
            f"Invalid recipient number '{to_number}'. Must be in E.164 format (e.g., +447700900123)."
        )
    
    # Warn about regional restrictions
    if to_number.startswith("+1"):
        raise ValueError(
            "Alphanumeric sender IDs are not supported for US/Canada (+1) numbers. "
            "Use a phone number instead."
        )
    
    # Get Messaging Profile ID from environment
    messaging_profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID")
    if not messaging_profile_id:
        raise ValueError("TELNYX_MESSAGING_PROFILE_ID environment variable not set")
    
    # Create message with alphanumeric sender ID
    response = client.messages.create(
        from_=sender_id,
        to=to_number,
        text=message,
        messaging_profile_id=messaging_profile_id,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": sender_id,
        "to": to_number,
        "direction": response.data.direction,
    }


@app.route("/sms/send-alphanumeric", methods=["POST"])
def send_alphanumeric_sms():
    """HTTP endpoint to send SMS with alphanumeric sender ID."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    sender_id = data.get("sender_id")  # Optional; uses env default if not provided
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_sms_with_alphanumeric_id(to_number, message, sender_id)
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


@app.route("/sms/validate-sender-id", methods=["POST"])
def validate_sender_id():
    """Endpoint to validate alphanumeric sender ID format before sending."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    sender_id = data.get("sender_id")
    
    if not sender_id:
        return jsonify({"error": "Missing required field: 'sender_id'"}), 400
    
    is_valid = validate_alphanumeric_sender_id(sender_id)
    
    return jsonify({
        "sender_id": sender_id,
        "is_valid": is_valid,
        "message": "Valid alphanumeric sender ID" if is_valid else "Invalid format. Must be 1-11 alphanumeric characters.",
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
