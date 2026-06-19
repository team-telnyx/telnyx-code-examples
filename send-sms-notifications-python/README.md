# SMS Notifications with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that sends SMS notifications to users based on events. This tutorial demonstrates how to implement a notification system using the Telnyx Python SDK, manage notification queues, handle retries for failed messages, and track delivery status via webhooks. You'll learn to send notifications at scale while maintaining reliability and proper error handling.

## Who Is This For?

- **Python developers** building sms features with Flask.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- pip (Python package manager).
- A publicly accessible URL for webhook testing (ngrok or similar for local development).
- Basic understanding of Flask and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app/models.py` to define the notification data structure:

```python
from datetime import datetime
from enum import Enum


class NotificationStatus(Enum):
    """Notification delivery status."""
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    RETRY = "retry"


class Notification:
    """In-memory notification record (use a database in production)."""
    
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


# In-memory storage (replace with database in production)
notifications_db = {}
notification_counter = 0
```

Create `app/notifications.py` to handle SMS sending logic:

```python
import os
import telnyx
from datetime import datetime
from app.models import Notification, NotificationStatus, notifications_db, notification_counter


def send_notification(recipient: str, message: str, notification_type: str = "alert") -> dict:
    """
    Send SMS notification and store delivery record.
    
    Args:
        recipient: Phone number in E.164 format (e.g., +15551234567).
        message: Notification text content.
        notification_type: Category of notification (alert, reminder, confirmation, etc.).
    
    Returns:
        Dictionary with notification details and message ID.
    
    Raises:
        ValueError: If phone number format is invalid.
        telnyx.AuthenticationError: If API key is invalid.
        telnyx.APIStatusError: If Telnyx API returns an error.
    """
    global notification_counter
    
    # Validate phone number format
    if not recipient.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Initialize Telnyx client
    client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
    
    # Create notification record
    notification = Notification(recipient, message, notification_type)
    notification_counter += 1
    notification.id = notification_counter
    
    try:
        # Send SMS via Telnyx
        response = client.messages.create(
            from_=from_number,
            to=recipient,
            text=message,
        )
        
        # Update notification with message ID and status
        notification.message_id = response.data.id
        notification.status = NotificationStatus.SENT.value
        notification.updated_at = datetime.utcnow()
        
        # Store in database
        notifications_db[notification.id] = notification
        
        # Return serializable response
        return {
            "notification_id": notification.id,
            "message_id": notification.message_id,
            "recipient": recipient,
            "status": notification.status,
            "notification_type": notification_type,
        }
    
    except Exception as e:
        # Mark notification as failed
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
    
    # Sort by creation date, newest first
    notifications.sort(key=lambda n: n.created_at, reverse=True)
    
    return [n.to_dict() for n in notifications[:limit]]


def update_notification_status(message_id: str, status: str) -> None:
    """Update notification status based on webhook event (called by webhook handler)."""
    for notification in notifications_db.values():
        if notification.message_id == message_id:
            notification.status = status
            notification.updated_at = datetime.utcnow()
            break
```

Create `app/routes.py` to define Flask endpoints:

```python
import telnyx
from flask import Blueprint, jsonify, request
from app.notifications import send_notification, get_notification_status, list_notifications, update_notification_status

bp = Blueprint("notifications", __name__, url_prefix="/api")


@bp.route("/notifications/send", methods=["POST"])
def send_sms_notification():
    """
    HTTP endpoint to send SMS notification.
    
    Request body:
    {
        "recipient": "+15559876543",
        "message": "Your order #12345 has been shipped",
        "notification_type": "order_update"
    }
    """
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
        return jsonify({"error": str(e)}), 404


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
    """
    Webhook endpoint to receive SMS delivery status updates from Telnyx.
    
    Telnyx sends events for:
    - message.sent: Message accepted by carrier
    - message.finalized: Final delivery status (delivered, failed, etc.)
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    # Extract event type and message details
    event_type = data.get("data", {}).get("event_type")
    message_id = data.get("data", {}).get("id")
    
    if not event_type or not message_id:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    # Map Telnyx event types to notification statuses
    status_map = {
        "message.sent": "sent",
        "message.finalized": "delivered",  # Simplified; check delivery_status for failures
    }
    
    # Check for delivery failures in finalized events
    if event_type == "message.finalized":
        delivery_status = data.get("data", {}).get("to", [{}])[0].get("status")
        if delivery_status == "failed":
            status = "failed"
        else:
            status = "delivered"
    else:
        status = status_map.get(event_type, "unknown")
    
    try:
        update_notification_status(message_id, status)
        return jsonify({"status": "processed"}), 200
    except Exception as e:
        # Log error but return 200 to prevent Telnyx from retrying
        print(f"Webhook processing error: {str(e)}")
        return jsonify({"status": "processed"}), 200
```

Create `app/__init__.py` to initialize the Flask application:

```python
from flask import Flask
from config import Config


def create_app(config_class=Config):
    """Application factory."""
    app = Flask(__name__)
    app.config.from_object(config_class)
    
    # Register blueprints
    from app.routes import bp
    app.register_blueprint(bp)
    
    # Health check endpoint
    @app.route("/health", methods=["GET"])
    def health():
        return {"status": "healthy"}, 200
    
    return app
```

Create `run.py` to start the Flask application:

```python
from app import create_app

if __name__ == "__main__":
    app = create_app()
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating the `.env` file. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Events | Notifications are sent successfully but status never updates to "delivered" or "failed". | Verify the webhook URL is publicly accessible and matches the URL configured in the [Telnyx Portal](https://portal.telnyx.com) under Messaging > Messaging Profiles. Use ngrok to expose your local Flask app: `ngrok http 5000`. Update the `WEBHOOK_URL` in `.env` and configure it in the portal. Test with `curl -X POST http://localhost:5000/api/webhooks/sms -H "Content-Type: application/json" -d '{"data": {"event_type": "message.sent", "id": "test-id"}}'`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff retry logic in your notification service. Space out requests by at least 100ms. For bulk notifications, consider using a message queue (Redis, RabbitMQ) to throttle sending. Check your Telnyx plan limits in the [Portal](https://portal.telnyx.com). |
| Message Not Sending | Notification is created but status remains "pending" or immediately becomes "failed". | Check that `TELNYX_PHONE_NUMBER` is set correctly in `.env` and is a valid Telnyx phone number. Verify the recipient phone number is in E.164 format. Check Flask logs for detailed error messages. Ensure your Telnyx account has sufficient credits and the phone number is active. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
