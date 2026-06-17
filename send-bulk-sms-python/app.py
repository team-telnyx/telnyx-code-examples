#!/usr/bin/env python3
"""Production-ready Flask application for sending bulk SMS via Telnyx."""

import os
import time
import telnyx
from datetime import datetime
from typing import List, Dict, Any
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Configuration
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")
BULK_SMS_RATE_LIMIT = int(os.getenv("BULK_SMS_RATE_LIMIT", "10"))
BULK_SMS_DELAY = float(os.getenv("BULK_SMS_DELAY", "0.1"))


def validate_phone_number(phone: str) -> bool:
    """Validate phone number is in E.164 format."""
    return isinstance(phone, str) and phone.startswith("+") and len(phone) >= 10


def send_single_sms(to_number: str, message: str) -> Dict[str, Any]:
    """
    Send a single SMS message via Telnyx.
    
    Args:
        to_number: Recipient phone number in E.164 format.
        message: Message text to send.
    
    Returns:
        Dictionary with message_id, status, and recipient info.
    
    Raises:
        ValueError: If phone number format is invalid.
        telnyx exceptions: For API errors (caught in route handler).
    """
    if not validate_phone_number(to_number):
        raise ValueError(f"Invalid phone number format: {to_number}. Use E.164 format (e.g., +15551234567)")
    
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "to": to_number,
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "pending",
    }


def send_bulk_sms(recipients: List[str], message: str) -> Dict[str, Any]:
    """
    Send SMS to multiple recipients with rate limiting and error tracking.
    
    Args:
        recipients: List of phone numbers in E.164 format.
        message: Message text to send to all recipients.
    
    Returns:
        Dictionary with success/failure counts and detailed results.
    """
    if not recipients:
        raise ValueError("Recipients list cannot be empty")
    
    if not message or len(message.strip()) == 0:
        raise ValueError("Message text cannot be empty")
    
    if len(message) > 1600:
        raise ValueError("Message exceeds maximum length of 1600 characters")
    
    results = {
        "total": len(recipients),
        "successful": 0,
        "failed": 0,
        "messages": [],
        "errors": [],
        "started_at": datetime.utcnow().isoformat(),
    }
    
    # Process each recipient with rate limiting
    for idx, recipient in enumerate(recipients):
        try:
            # Validate before sending
            if not validate_phone_number(recipient):
                results["failed"] += 1
                results["errors"].append({
                    "recipient": recipient,
                    "error": "Invalid phone number format",
                })
                continue
            
            # Send message
            msg_result = send_single_sms(recipient, message)
            results["successful"] += 1
            results["messages"].append(msg_result)
            
            # Rate limiting: sleep between requests to avoid hitting API limits
            if idx < len(recipients) - 1:
                time.sleep(BULK_SMS_DELAY)
        
        except telnyx.RateLimitError:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": "Rate limit exceeded. Consider increasing BULK_SMS_DELAY.",
            })
        except telnyx.APIStatusError as e:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": f"API error: {str(e)}",
                "status_code": e.status_code,
            })
        except ValueError as e:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": str(e),
            })
    
    results["completed_at"] = datetime.utcnow().isoformat()
    return results


@app.route("/sms/bulk/send", methods=["POST"])
def send_bulk_sms_endpoint():
    """HTTP endpoint to send bulk SMS messages."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    recipients = data.get("recipients", [])
    message = data.get("message")
    
    if not isinstance(recipients, list) or len(recipients) == 0:
        return jsonify({"error": "Missing or invalid 'recipients' field. Must be a non-empty list."}), 400
    
    if not message:
        return jsonify({"error": "Missing required field: 'message'"}), 400
    
    try:
        result = send_bulk_sms(recipients, message)
        return jsonify(result), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sms/bulk/status", methods=["GET"])
def bulk_sms_status():
    """Health check endpoint for bulk SMS service."""
    return jsonify({
        "service": "Telnyx Bulk SMS",
        "status": "operational",
        "rate_limit": BULK_SMS_RATE_LIMIT,
        "delay_between_messages": BULK_SMS_DELAY,
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
