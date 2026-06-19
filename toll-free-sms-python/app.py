#!/usr/bin/env python3
"""Production-ready Flask application for toll-free SMS via Telnyx."""

import os
import json
import logging
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

# Configure logging for production debugging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store message delivery status in memory (use a database in production)
message_status_store = {}


def send_tollfree_sms(to_number: str, message: str, messaging_profile_id: str = None) -> dict:
    """
    Send SMS via toll-free number with delivery tracking.
    
    Args:
        to_number: Recipient phone number in E.164 format.
        message: SMS message text (max 160 characters per segment).
        messaging_profile_id: Optional Messaging Profile ID for routing.
    
    Returns:
        Dictionary with message ID, status, and metadata.
    
    Raises:
        ValueError: If phone number format is invalid.
    """
    tollfree_number = os.getenv("TOLLFREE_NUMBER")
    if not tollfree_number:
        raise ValueError("TOLLFREE_NUMBER environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Validate message length (SMS segments are 160 chars for GSM-7, 70 for Unicode)
    if len(message) > 1600:  # Allow up to 10 segments
        raise ValueError("Message exceeds maximum length (1600 characters)")
    
    # Calculate expected segments for billing awareness
    segment_count = (len(message) + 159) // 160
    
    try:
        # Create message with optional Messaging Profile for compliance routing
        create_params = {
            "from_": tollfree_number,
            "to": to_number,
            "text": message,
        }
        
        if messaging_profile_id:
            create_params["messaging_profile_id"] = messaging_profile_id
        
        response = client.messages.create(**create_params)
        
        # Extract serializable data — SDK objects are NOT JSON-serializable
        message_id = response.data.id
        status = response.data.to[0].status if response.data.to else "queued"
        
        # Store metadata for webhook tracking
        message_status_store[message_id] = {
            "id": message_id,
            "from": tollfree_number,
            "to": to_number,
            "status": status,
            "segments": segment_count,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        logger.info(f"SMS sent: {message_id} to {to_number} ({segment_count} segments)")
        
        return {
            "message_id": message_id,
            "status": status,
            "from": tollfree_number,
            "to": to_number,
            "segments": segment_count,
            "created_at": datetime.utcnow().isoformat(),
        }
    
    except telnyx.APIStatusError as e:
        logger.error(f"Telnyx API error: {e.status_code} - {str(e)}")
        raise


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy", "timestamp": datetime.utcnow().isoformat()}), 200


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """
    HTTP endpoint to send toll-free SMS.
    
    Request body:
    {
        "to": "+15551234567",
        "message": "Your verification code is 123456"
    }
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_tollfree_sms(
            to_number,
            message,
            messaging_profile_id=os.getenv("MESSAGING_PROFILE_ID")
        )
        return jsonify(result), 200
    
    except telnyx.AuthenticationError:
        logger.error("Authentication failed: invalid API key")
        return jsonify({"error": "Invalid API key"}), 401
    
    except telnyx.RateLimitError:
        logger.warning("Rate limit exceeded")
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    
    except telnyx.APIStatusError as e:
        logger.error(f"API error: {e.status_code} - {str(e)}")
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    
    except telnyx.APIConnectionError:
        logger.error("Network error connecting to Telnyx")
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    
    except ValueError as e:
        logger.warning(f"Validation error: {str(e)}")
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sms/status/<message_id>", methods=["GET"])
def get_message_status(message_id: str):
    """Retrieve cached message delivery status."""
    if message_id not in message_status_store:
        return jsonify({"error": "Message not found"}), 404
    
    return jsonify(message_status_store[message_id]), 200


@app.route("/webhooks/message-status", methods=["POST"])
def webhook_message_status():
    """
    Webhook endpoint for Telnyx message delivery status updates.
    
    Telnyx sends POST requests with event data when message status changes.
    Configure this URL in your Messaging Profile webhook settings.
    """
    try:
        payload = request.get_json()
        
        if not payload:
            logger.warning("Received empty webhook payload")
            return jsonify({"error": "Empty payload"}), 400
        
        # Extract event data
        event_type = payload.get("type")
        data = payload.get("data", {})
        message_id = data.get("id")
        status = data.get("to", [{}])[0].get("status", "unknown") if data.get("to") else "unknown"
        
        logger.info(f"Webhook received: {event_type} for message {message_id}, status: {status}")
        
        # Update message status in store
        if message_id in message_status_store:
            message_status_store[message_id]["status"] = status
            message_status_store[message_id]["updated_at"] = datetime.utcnow().isoformat()
            
            # Log delivery events for monitoring
            if status == "delivered":
                logger.info(f"Message {message_id} delivered successfully")
            elif status == "failed":
                logger.error(f"Message {message_id} delivery failed")
        
        # Always return 200 to acknowledge receipt (Telnyx will retry on non-2xx)
        return jsonify({"status": "received"}), 200
    
    except Exception as e:
        logger.error(f"Webhook processing error: {str(e)}")
        return jsonify({"error": "Webhook processing failed"}), 500


@app.route("/sms/messages", methods=["GET"])
def list_messages():
    """List all messages sent in this session with their current status."""
    messages = list(message_status_store.values())
    return jsonify({"count": len(messages), "messages": messages}), 200


@app.errorhandler(Exception)
def handle_error(error):
    """Global error handler for unhandled exceptions."""
    logger.error(f"Unhandled exception: {str(error)}", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    logger.info("Starting Telnyx Toll-Free SMS Flask application")
    app.run(debug=os.getenv("FLASK_ENV") == "development", port=5000, host="0.0.0.0")
