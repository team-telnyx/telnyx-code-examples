# Toll Free SMS with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that sends SMS messages using toll-free numbers via the Telnyx Python SDK. This tutorial covers toll-free number provisioning, messaging profile configuration, compliance requirements for A2P (Application-to-Person) messaging, and best practices for high-volume SMS delivery. You'll learn how to handle rate limiting, implement retry logic, and monitor message delivery status through webhooks.

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
- A provisioned toll-free number (888, 877, 866, 855, 844, or 833 prefix) enabled for outbound SMS.
- A Messaging Profile configured with a webhook URL for delivery status tracking.
- pip (Python package manager).
- ngrok or similar tool to expose your local Flask server for webhook testing (optional but recommended).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/toll-free-sms-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/toll-free-sms-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, toll-free SMS sender, and webhook handler:

```python
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
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Toll-Free Number Not Configured | You receive a Telnyx API error stating the number is not available or not provisioned for SMS. | Confirm your toll-free number is provisioned in the Telnyx Portal under Phone Numbers. Verify the number is enabled for outbound SMS in the number settings. Ensure the number is in E.164 format in your `.env` file (e.g., `+18885551234`). |
| Messaging Profile Not Found | The API returns a 404 or error about an invalid Messaging Profile ID. | Verify your `MESSAGING_PROFILE_ID` in the `.env` file matches a profile in the Telnyx Portal under Messaging > Profiles. If you don't have a Messaging Profile, create one in the Portal and associate it with your toll-free number. You can also omit the `messaging_profile_id` parameter to use the default profile. |
| Webhook Not Receiving Updates | Message status remains "queued" and never updates to "delivered" or "failed". | Ensure your webhook URL is publicly accessible (not localhost). Use ngrok or similar to expose your Flask server. Configure the webhook URL in your Messaging Profile settings in the Telnyx Portal. Verify the URL is correct and includes the full path (e.g., `https://your-domain.com/webhooks/message-status`). Check Flask logs for incoming webhook requests. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff retry logic in your client code. Telnyx allows 300 requests per second per API key. If sending bulk SMS, space requests over time or use the bulk SMS endpoint. Consider implementing a message queue (Redis, RabbitMQ) to throttle outbound messages. |
| Message Segments Calculation Incorrect | Messages are being split into more segments than expected, increasing costs. | Remember that SMS segments are 160 characters for GSM-7 encoding (standard ASCII) and 70 characters for Unicode. The code calculates segments as `(len(message) + 159) // 160`. If your message contains Unicode characters, Telnyx automatically switches to Unicode encoding, reducing the character limit per segment. Keep messages under 160 characters when possible to avoid multi-segment billing. |

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
