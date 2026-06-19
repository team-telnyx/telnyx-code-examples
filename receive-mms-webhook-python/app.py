#!/usr/bin/env python3
"""Production-ready Flask webhook endpoint for receiving MMS via Telnyx."""

import os
import json
import logging
import requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Telnyx client (not needed for receiving webhooks, but useful for future operations)
import telnyx
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def download_media(media_url: str, filename: str) -> dict:
    """Download media attachment from Telnyx and save locally."""
    try:
        response = requests.get(media_url, timeout=10)
        response.raise_for_status()
        
        # Create media directory if it doesn't exist
        os.makedirs("media", exist_ok=True)
        
        filepath = os.path.join("media", filename)
        with open(filepath, "wb") as f:
            f.write(response.content)
        
        return {
            "filename": filename,
            "filepath": filepath,
            "size_bytes": len(response.content),
            "status": "downloaded",
        }
    except requests.RequestException as e:
        logger.error(f"Failed to download media from {media_url}: {str(e)}")
        return {
            "filename": filename,
            "status": "failed",
            "error": "Failed to download media",
        }


def process_inbound_mms(payload: dict) -> dict:
    """Extract and process inbound MMS message data."""
    data = payload.get("data", {})
    
    # Extract message metadata
    message_id = data.get("id")
    from_number = data.get("from", {}).get("phone_number", "unknown")
    to_number = data.get("to", [{}])[0].get("phone_number", "unknown")
    text = data.get("text", "")
    received_at = data.get("received_at", datetime.utcnow().isoformat())
    
    # Extract media attachments
    media_list = []
    media_urls = data.get("media", [])
    
    for idx, media in enumerate(media_urls):
        media_url = media.get("url")
        media_type = media.get("type", "unknown")
        
        if media_url:
            # Generate filename from media type and index
            filename = f"{message_id}_{idx}.{media_type.split('/')[-1]}"
            media_info = download_media(media_url, filename)
            media_list.append(media_info)
    
    # Return structured message data
    return {
        "message_id": message_id,
        "from": from_number,
        "to": to_number,
        "text": text,
        "received_at": received_at,
        "media_count": len(media_list),
        "media": media_list,
        "direction": "inbound",
    }


@app.route("/webhooks/message", methods=["POST"])
def receive_mms():
    """Webhook endpoint to receive inbound MMS messages."""
    try:
        payload = request.get_json()
        
        if not payload:
            logger.warning("Received empty webhook payload")
            return jsonify({"error": "Empty payload"}), 400
        
        # Validate webhook event type
        event_type = payload.get("event_type")
        if event_type != "message.received":
            logger.info(f"Ignoring non-received event: {event_type}")
            return jsonify({"status": "ignored", "event_type": event_type}), 200
        
        # Process the inbound MMS
        message_data = process_inbound_mms(payload)
        
        logger.info(
            f"Received MMS from {message_data['from']} to {message_data['to']} "
            f"with {message_data['media_count']} attachments"
        )
        
        # TODO: Store message_data in database for persistence
        # Example: db.messages.insert_one(message_data)
        
        # Return 200 OK to acknowledge receipt (Telnyx expects this)
        return jsonify({
            "status": "received",
            "message_id": message_data["message_id"],
            "media_count": message_data["media_count"],
        }), 200
        
    except json.JSONDecodeError:
        logger.error("Invalid JSON in webhook payload")
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception as e:
        logger.error(f"Unexpected error processing webhook: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages", methods=["GET"])
def list_received_messages():
    """Retrieve list of received messages (for demonstration)."""
    try:
        # In production, query your database instead
        messages = []
        if os.path.exists("media"):
            for filename in os.listdir("media"):
                messages.append({
                    "filename": filename,
                    "path": f"media/{filename}",
                })
        
        return jsonify({
            "count": len(messages),
            "messages": messages,
        }), 200
        
    except Exception as e:
        logger.error(f"Error listing messages: {str(e)}")
        return jsonify({"error": "Failed to list messages"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
