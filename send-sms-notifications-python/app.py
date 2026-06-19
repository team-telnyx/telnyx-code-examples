#!/usr/bin/env python3
"""Production-ready Flask application for SMS notifications via Telnyx."""

import os
import telnyx
from datetime import datetime
from enum import Enum
from dotenv import load_dotenv
from flask import Flask, jsonify, request, Blueprint

load_dotenv()


# ============================================================================
# Configuration
# ============================================================================

class Config:
    """Base configuration."""
    TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
    TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")
    WEBHOOK_URL = os.getenv("WEBHOOK_URL")
    FLASK_ENV = os.getenv("FLASK_ENV", "development")
    MAX_RETRIES = 3
    RETRY_DELAY = 5


# ============================================================================
# Models
# ============================================================================

class NotificationStatus(Enum):
    """Notification delivery status."""
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    RETRY = "retry"


class Notification:
    """In-memory notification record."""
    
    def __init__(self, recipient: str, message: str, notification_type: str = "alert"):
        self.id = None
        self.recipient = recipient
        self.message = message
        self.notification_type = notification_type
        self.status = NotificationStatus.PENDING.value
        self.message_id = None
        self.retry_count = 0
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
    
    def to_dict(self) -> dict:
        """Convert notification to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "recipient": self.recipient,
            "message": self.message,
            "notification_type": self.notification_type,
            "status": self.status,
            "message_id": self.message_id,
            "retry_count": self.retry_count,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


# In-memory storage
notifications_db = {}
notification_counter = 0


# ============================================================================
# Notification Service
# ============================================================================

def send_notification(recipient: str, message: str, notification_type: str = "alert") -> dict:
    """Send SMS notification and store delivery record."""
    global notification_counter
    
    if not recipient.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
    
    notification = Notification(recipient, message, notification_type)
    notification_counter += 1
    notification.id = notification_counter
    
    try:
        response = client.messages.create(
            from_=from_number,
            to=recipient,
            text=message,
        )
        
        notification.message_id = response.data.id
        notification.status = NotificationStatus.SENT.value
        notification.updated_at = datetime.utcnow()
        notifications_db[notification.id] = notification
        
        return {
            "notification_id": notification.id,
            "message_id": notification.message_id,
            "recipient": recipient,
            "status": notification.status,
            "notification_type": notification_type,
        }
    
    except Exception as e:
        notification.status = NotificationStatus.FAILED.value
        notification.updated_at = datetime.utcnow()
        notifications_db[notification.id] = notification
        raise


def get_notification_status(notification_id: int) -> dict:
    """Retrieve notification status by ID."""
    if notification_id not in notifications_db:
        raise ValueError(f"Notification {notification_id} not found")
    
    notification = notifications_db[notification_id]
    return notification.to_dict()


def list_notifications(status: str = None, limit: int = 50) -> list:
    """List all notifications, optionally filtered by status."""
    notifications = list(notifications_db.values())
    
    if status:
        notifications = [n for n in notifications if n.status == status]
    
    notifications.sort(key=lambda n: n.created_at, reverse=True)
    
    return [n.to_dict() for n in notifications[:limit]]


def update_notification_status(message_id: str, status: str) -> None:
    """Update notification status based on webhook event."""
    for notification in notifications_db.values():
        if notification.message_id == message_id:
            notification.status = status
            notification.updated_at = datetime.utcnow()
            break


# ============================================================================
# Flask Application
# ============================================================================

app = Flask(__name__)
app.config.from_object(Config)

bp = Blueprint("notifications", __name__, url_prefix="/api")


@bp.route("/notifications/send", methods=["POST"])
def send_sms_notification():
    """HTTP endpoint to send SMS notification."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    recipient = data.get("recipient")
    message = data.get("message")
    notification_type = data.get("notification_type", "alert")
    
    if not recipient or not message:
        return jsonify({"error": "Missing required fields: 'recipient' and 'message'"}), 400
    
    if len(message) > 1600:
        return jsonify({"error": "Message exceeds 1600 characters"}), 400
    
    try:
        result = send_notification(recipient, message, notification_type)
        return jsonify(result), 201
    
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


@bp.route("/notifications/<int:notification_id>", methods=["GET"])
def get_notification(notification_id: int):
    """Retrieve notification status by ID."""
    try:
        notification = get_notification_status(notification_id)
        return jsonify(notification), 200
    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404


@bp.route("/notifications", methods=["GET"])
def list_all_notifications():
    """List all notifications with optional filtering."""
    status = request.args.get("status")
    limit = request.args.get("limit", 50, type=int)
    
    try:
        notifications = list_notifications(status=status, limit=limit)
        return jsonify({"count": len(notifications), "notifications": notifications}), 200
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@bp.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    """Webhook endpoint to receive SMS delivery status updates from Telnyx."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    message_id = data.get("data", {}).get("id")
    
    if not event_type or not message_id:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    if event_type == "message.finalized":
        delivery_status = data.get("data", {}).get("to", [{}])[0].get("status")
        status = "failed" if delivery_status == "failed" else "delivered"
    else:
        status = "sent" if event_type == "message.sent" else "unknown"
    
    try:
        update_notification_status(message_id, status)
        return jsonify({"status": "processed"}), 200
    except Exception as e:
        print(f"Webhook processing error: {str(e)}")
        return jsonify({"status": "processed"}), 200


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


app.register_blueprint(bp)


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
