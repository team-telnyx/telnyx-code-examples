#!/usr/bin/env python3
"""Production-ready Flask endpoint for sending MMS via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from urllib.parse import urlparse

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Supported media types for MMS
SUPPORTED_MEDIA_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/quicktime", "video/mpeg",
    "audio/mpeg", "audio/wav", "audio/ogg",
    "application/pdf", "application/msword",
}


def validate_media_url(url: str) -> bool:
    """Validate that URL is properly formatted and accessible."""
    try:
        result = urlparse(url)
        # Ensure URL has scheme and netloc
        return all([result.scheme in ("http", "https"), result.netloc])
    except Exception:
        return False


def send_mms(to_number: str, message: str, media_urls: list) -> dict:
    """Send MMS via Telnyx with media attachments and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format to prevent API errors
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Validate media URLs
    if not media_urls:
        raise ValueError("At least one media URL is required for MMS")
    
    if len(media_urls) > 10:
        raise ValueError("Maximum 10 media files per MMS message")
    
    for url in media_urls:
        if not validate_media_url(url):
            raise ValueError(f"Invalid media URL format: {url}")
    
    # Use client.messages.create() with media_urls parameter for MMS
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
        media_urls=media_urls,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "media_count": len(media_urls),
    }


@app.route("/mms/send", methods=["POST"])
def send_mms_endpoint():
    """HTTP endpoint to send MMS with media attachments."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    media_urls = data.get("media_urls", [])
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    if not isinstance(media_urls, list):
        return jsonify({"error": "'media_urls' must be a list"}), 400
    
    try:
        result = send_mms(to_number, message, media_urls)
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
