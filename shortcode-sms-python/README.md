# Shortcode SMS with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that sends and receives SMS messages using a Telnyx shortcode. This tutorial demonstrates how to configure a messaging profile with webhooks, handle inbound SMS, manage shortcode routing, and implement proper error handling for a two-way SMS system. Shortcodes are ideal for high-volume A2P (application-to-person) messaging, customer engagement campaigns, and interactive SMS applications.

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
- A Telnyx shortcode (e.g., 123456) provisioned for SMS.
- A publicly accessible URL for webhook delivery (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/shortcode-sms-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/shortcode-sms-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, shortcode message sending, and webhook handling:

```python
import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_SHORTCODE = os.getenv("TELNYX_SHORTCODE")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

# In-memory storage for received messages (use a database in production)
received_messages = []


def send_shortcode_sms(to_number: str, message: str) -> dict:
    """Send SMS via shortcode and return JSON-serializable response data."""
    if not TELNYX_SHORTCODE:
        raise ValueError("TELNYX_SHORTCODE environment variable not set")
    
    # Validate E.164 format to prevent API errors
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Validate message length (SMS segments are 160 chars for standard, 153 for Unicode)
    if len(message) == 0:
        raise ValueError("Message cannot be empty")
    if len(message) > 1600:
        raise ValueError("Message exceeds maximum length (1600 characters)")
    
    # Send message using shortcode as from_number
    response = client.messages.create(
        from_=TELNYX_SHORTCODE,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "queued",
        "from": TELNYX_SHORTCODE,
        "to": to_number,
        "segments": response.data.parts if hasattr(response.data, "parts") else 1,
    }


def configure_messaging_profile(webhook_url: str) -> dict:
    """Configure messaging profile with webhook URL for inbound SMS."""
    # Retrieve existing messaging profiles
    profiles = client.messaging_profiles.list()
    
    # Find or create a profile for shortcode messaging
    profile = None
    for p in profiles.data:
        if hasattr(p, "name") and "shortcode" in p.name.lower():
            profile = p
            break
    
    if not profile:
        # Create new messaging profile if none exists
        profile_response = client.messaging_profiles.create(
            name="Shortcode SMS Profile",
        )
        profile = profile_response.data
    
    # Update webhook URL for inbound messages
    webhook_config = {
        "url": webhook_url,
        "failover_url": None,
    }
    
    # Note: Webhook configuration is typically done via the Telnyx Portal
    # This is a placeholder for the pattern; actual implementation depends on SDK version
    return {
        "profile_id": profile.id,
        "name": profile.name,
        "webhook_url": webhook_url,
    }


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send SMS via shortcode."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_shortcode_sms(to_number, message)
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


@app.route("/webhooks/sms", methods=["POST"])
def handle_inbound_sms():
    """Webhook endpoint to receive inbound SMS messages."""
    try:
        payload = request.get_json()
        
        if not payload:
            return jsonify({"error": "No payload received"}), 400
        
        # Parse webhook event
        event_type = payload.get("data", {}).get("event_type")
        
        if event_type == "message.received":
            message_data = payload.get("data", {})
            
            # Extract message details
            inbound_message = {
                "id": message_data.get("id"),
                "from": message_data.get("from", {}).get("phone_number"),
                "to": message_data.get("to", [{}])[0].get("phone_number"),
                "text": message_data.get("text"),
                "received_at": message_data.get("received_at"),
                "direction": message_data.get("direction"),
            }
            
            # Store message (in production, save to database)
            received_messages.append(inbound_message)
            
            # Log for debugging
            print(f"Inbound SMS: {inbound_message['from']} -> {inbound_message['to']}: {inbound_message['text']}")
            
            return jsonify({"status": "received"}), 200
        
        elif event_type == "message.finalized":
            # Handle delivery status updates
            message_data = payload.get("data", {})
            status = message_data.get("to", [{}])[0].get("status")
            message_id = message_data.get("id")
            
            print(f"Message {message_id} status: {status}")
            
            return jsonify({"status": "processed"}), 200
        
        else:
            # Acknowledge other event types
            return jsonify({"status": "acknowledged"}), 200
    
    except Exception as e:
        print(f"Webhook error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages/received", methods=["GET"])
def list_received_messages():
    """Retrieve all received inbound messages."""
    return jsonify(received_messages), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy", "timestamp": datetime.utcnow().isoformat()}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving inbound messages | SMS is sent to the shortcode but the `/webhooks/sms` endpoint is never called. | Verify the webhook URL is configured in the [Telnyx Portal](https://portal.telnyx.com) under your messaging profile. Ensure the URL is publicly accessible (test with `curl https://your-url/health`). If using ngrok, confirm the tunnel is active and the URL in the portal matches your current ngrok URL. Telnyx webhooks require HTTPS; ngrok provides this by default. |
| "TELNYX_SHORTCODE environment variable not set" error | The application raises a ValueError on startup or when sending a message. | Verify your `.env` file contains the `TELNYX_SHORTCODE` variable with your provisioned shortcode (e.g., `TELNYX_SHORTCODE=123456`). Ensure the file is named exactly `.env` and is in the same directory as `app.py`. Restart the Flask server after updating the `.env` file. |
| Rate limit errors (429) when sending bulk messages | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff and request queuing for bulk SMS. Add a delay between requests (e.g., `time.sleep(0.1)` between calls) or use a task queue like Celery for production workloads. Check your Telnyx plan limits in the Portal. |
| Shortcode messages show "failed" status | Messages are sent but delivery status is "failed" or "undelivered". | Verify the destination phone number is in valid E.164 format (e.g., `+15551234567`). Confirm the shortcode is provisioned and active in the Telnyx Portal. Check that the shortcode is registered for the destination country (some countries restrict shortcode messaging). Review the detailed error in the Telnyx Portal's message logs. |
| ngrok URL keeps changing | The ngrok tunnel URL changes each time ngrok restarts, breaking the webhook configuration. | Use ngrok's paid plan for a static subdomain, or use a service like Cloudflare Tunnel for a permanent URL. Alternatively, deploy to a cloud platform (AWS, Heroku, DigitalOcean) with a fixed domain name instead of relying on ngrok for production. |

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
