#!/usr/bin/env python3
"""Production-ready Flask webhook endpoint for receiving inbound MMS via Telnyx."""

import os
import json
import logging
import requests
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)


def download_media(media_url: str, filename: str) -> dict:
    """Download a media attachment from Telnyx and save it locally.

    Telnyx media URLs are signed and short-lived, so download promptly.
    """
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
    except requests.RequestException:
        # Log the detail server-side; never leak it in a response body.
        logger.exception("Failed to download media from %s", media_url)
        return {
            "filename": filename,
            "status": "failed",
            "error": "Failed to download media",
        }


def process_inbound_mms(event_data: dict) -> dict:
    """Extract and process inbound MMS message data.

    Args:
        event_data: The ``data`` object from the webhook envelope. ``id`` and
            ``event_type`` live at this level; operational message fields live
            under ``data["payload"]``.
    """
    p = event_data.get("payload", {})

    # Extract message metadata from data.payload
    message_id = event_data.get("id")
    from_number = p.get("from", {}).get("phone_number", "unknown")
    to_number = p.get("to", [{}])[0].get("phone_number", "unknown")
    text = p.get("text", "")
    received_at = p.get("received_at", datetime.utcnow().isoformat())

    # Extract media attachments
    media_list = []
    media_urls = p.get("media", [])

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
    # Verify the Telnyx Ed25519 signature against the raw body before trusting
    # anything. unwrap() reads the telnyx-signature-ed25519 / telnyx-timestamp
    # headers and raises if the signature or timestamp (replay) check fails.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    try:
        payload = request.get_json(silent=True)

        if not payload:
            logger.warning("Received empty webhook payload")
            return jsonify({"error": "invalid request body"}), 400

        # event_type stays at the data level; message fields live under data.payload
        event_data = payload.get("data", {})
        event_type = event_data.get("event_type")
        if event_type != "message.received":
            logger.info("Ignoring non-received event: %s", event_type)
            return jsonify({"status": "ignored", "event_type": event_type}), 200

        # Process the inbound MMS
        message_data = process_inbound_mms(event_data)

        logger.info(
            "Received MMS from %s to %s with %s attachments",
            message_data["from"], message_data["to"], message_data["media_count"],
        )

        # TODO: Store message_data in database for persistence
        # Example: db.messages.insert_one(message_data)

        # Return 200 OK to acknowledge receipt (Telnyx expects this)
        return jsonify({
            "status": "received",
            "message_id": message_data["message_id"],
            "media_count": message_data["media_count"],
        }), 200

    except Exception:
        # Log the detail server-side; return a generic message to the caller.
        logger.exception("Unexpected error processing webhook")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages", methods=["GET"])
def list_received_messages():
    """Retrieve the list of downloaded media (for demonstration)."""
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

    except Exception:
        logger.exception("Error listing messages")
        return jsonify({"error": "Failed to list messages"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
