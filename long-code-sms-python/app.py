#!/usr/bin/env python3
"""Production-ready Flask application for long code SMS with Telnyx."""

import os
import time
import telnyx
from datetime import datetime
from collections import defaultdict
from flask import Flask, jsonify, request
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Application configuration from environment variables."""
    
    TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
    TELNYX_LONG_CODE = os.getenv("TELNYX_LONG_CODE")
    WEBHOOK_URL = os.getenv("WEBHOOK_URL")
    
    # Rate limiting: max messages per second per recipient
    RATE_LIMIT_PER_SECOND = 1
    
    # Message queue settings
    MAX_QUEUE_SIZE = 1000
    
    @classmethod
    def validate(cls):
        """Validate required configuration at startup."""
        if not cls.TELNYX_API_KEY:
            raise ValueError("TELNYX_API_KEY environment variable not set")
        if not cls.TELNYX_LONG_CODE:
            raise ValueError("TELNYX_LONG_CODE environment variable not set")
        if not cls.WEBHOOK_URL:
            raise ValueError("WEBHOOK_URL environment variable not set")
        if not cls.TELNYX_LONG_CODE.startswith("+"):
            raise ValueError("TELNYX_LONG_CODE must be in E.164 format (e.g., +15551234567)")


# Validate configuration at startup
Config.validate()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=Config.TELNYX_API_KEY)

# In-memory message queue and delivery tracking
message_queue = []
message_status = {}  # Maps message_id -> {status, timestamp, recipient}
rate_limiter = defaultdict(list)  # Maps recipient -> [timestamps]


def is_rate_limited(recipient: str) -> bool:
    """Check if recipient has exceeded rate limit (1 message per second)."""
    now = time.time()
    # Remove timestamps older than 1 second
    rate_limiter[recipient] = [ts for ts in rate_limiter[recipient] if now - ts < 1.0]
    
    if len(rate_limiter[recipient]) >= Config.RATE_LIMIT_PER_SECOND:
        return True
    
    rate_limiter[recipient].append(now)
    return False


def queue_message(to_number: str, message: str, metadata: dict = None) -> dict:
    """Queue a message for sending with rate limiting."""
    if is_rate_limited(to_number):
        raise ValueError(f"Rate limit exceeded for {to_number}. Max 1 message per second.")
    
    if len(message_queue) >= Config.MAX_QUEUE_SIZE:
        raise ValueError("Message queue is full. Please try again later.")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    if len(message) > 160:
        # Long messages will be split into segments; warn the user
        segments = (len(message) + 159) // 160
        print(f"Message will be split into {segments} segments")
    
    queue_item = {
        "to": to_number,
        "text": message,
        "metadata": metadata or {},
        "queued_at": datetime.utcnow().isoformat(),
    }
    
    message_queue.append(queue_item)
    return {"queued": True, "position": len(message_queue)}


def send_queued_message(queue_item: dict) -> dict:
    """Send a single message from the queue via Telnyx API."""
    response = client.messages.create(
        from_=Config.TELNYX_LONG_CODE,
        to=queue_item["to"],
        text=queue_item["text"],
    )
    
    # Track message status
    message_status[response.data.id] = {
        "status": "sent",
        "timestamp": datetime.utcnow().isoformat(),
        "recipient": queue_item["to"],
        "metadata": queue_item["metadata"],
    }
    
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "queued",
        "from": Config.TELNYX_LONG_CODE,
        "to": queue_item["to"],
    }


@app.route("/sms/queue", methods=["POST"])
def queue_sms_endpoint():
    """Queue an SMS for sending with rate limiting."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    metadata = data.get("metadata", {})
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = queue_message(to_number, message, metadata)
        return jsonify(result), 202
    
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """Send a single SMS immediately (bypasses queue)."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        response = client.messages.create(
            from_=Config.TELNYX_LONG_CODE,
            to=to_number,
            text=message,
        )
        
        # Track message status
        message_status[response.data.id] = {
            "status": "sent",
            "timestamp": datetime.utcnow().isoformat(),
            "recipient": to_number,
        }
        
        return jsonify({
            "message_id": response.data.id,
            "status": response.data.to[0].status if response.data.to else "queued",
            "from": Config.TELNYX_LONG_CODE,
            "to": to_number,
        }), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Telnyx rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sms/status/<message_id>", methods=["GET"])
def get_message_status(message_id: str):
    """Retrieve delivery status for a sent message."""
    if message_id not in message_status:
        return jsonify({"error": "Message not found"}), 404
    
    status_data = message_status[message_id]
    return jsonify(status_data), 200


@app.route("/webhooks/message", methods=["POST"])
def handle_message_webhook():
    """Handle inbound SMS and delivery status updates from Telnyx."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    message_id = data.get("data", {}).get("id")
    
    if event_type == "message.received":
        # Handle inbound SMS
        from_number = data.get("data", {}).get("from", {}).get("phone_number")
        message_text = data.get("data", {}).get("text")
        
        print(f"[INBOUND] From: {from_number}, Message: {message_text}")
        
        # Store inbound message
        if message_id:
            message_status[message_id] = {
                "status": "received",
                "direction": "inbound",
                "from": from_number,
                "text": message_text,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        return jsonify({"status": "received"}), 200
    
    elif event_type == "message.finalized":
        # Handle delivery status update
        to_number = data.get("data", {}).get("to", [{}])[0].get("phone_number")
        delivery_status = data.get("data", {}).get("to", [{}])[0].get("status")
        
        print(f"[DELIVERY] Message {message_id} to {to_number}: {delivery_status}")
        
        # Update message status
        if message_id:
            message_status[message_id] = {
                "status": delivery_status,
                "direction": "outbound",
                "to": to_number,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        return jsonify({"status": "updated"}), 200
    
    else:
        # Acknowledge other event types
        return jsonify({"status": "acknowledged"}), 200


@app.route("/sms/queue/process", methods=["POST"])
def process_queue():
    """Process all queued messages (call this periodically or on-demand)."""
    if not message_queue:
        return jsonify({"processed": 0, "failed": 0}), 200
    
    processed = 0
    failed = 0
    results = []
    
    while message_queue:
        queue_item = message_queue.pop(0)
        
        try:
            result = send_queued_message(queue_item)
            results.append(result)
            processed += 1
        except telnyx.AuthenticationError:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": "Invalid API key",
            })
        except telnyx.RateLimitError:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": "Telnyx rate limit exceeded",
            })
        except telnyx.APIStatusError as e:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": "API request failed",
            })
        except telnyx.APIConnectionError:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": "Network error connecting to Telnyx",
            })
        except Exception as e:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": "Internal server error",
            })
    
    return jsonify({
        "processed": processed,
        "failed": failed,
        "results": results,
    }), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "queue_size": len(message_queue),
        "tracked_messages": len(message_status),
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
