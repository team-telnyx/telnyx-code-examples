# MMS Receive with Python and Flask

## What Does This Example Do?

Build a production-ready Flask webhook endpoint that receives and processes inbound MMS messages using the Telnyx Python SDK. This tutorial demonstrates how to configure a Messaging Profile with a webhook URL, validate incoming MMS payloads, extract media attachments, and persist message data. You'll learn to handle the `message.received` webhook event and implement proper error handling for production resilience.

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
- A Telnyx phone number enabled for inbound SMS/MMS.
- A publicly accessible URL (ngrok, Heroku, or similar) to receive webhooks.
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to process inbound MMS messages and download media attachments:

```python
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
            "error": str(e),
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
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not being triggered | You send an MMS to your Telnyx number but the Flask endpoint is never called. | Verify your Messaging Profile webhook URL is correctly configured in the Telnyx Portal and matches your ngrok URL. Ensure ngrok is running and the URL is publicly accessible. Check that your Telnyx phone number is associated with the correct Messaging Profile. Test the webhook URL directly in your browser to confirm it's reachable. |
| Media download fails with 403 Forbidden | The `download_media()` function logs "Failed to download media" with a 403 error. | Media URLs from Telnyx are signed and expire after a short time. Ensure you download media immediately upon receiving the webhook. If processing is delayed, the URL may have expired. Implement a queue (e.g., Celery) to process webhooks asynchronously and download media promptly. |
| Empty or missing media in webhook payload | The MMS is received but `media_urls` is empty or the `media` field is missing from the payload. | Verify the sender's device supports MMS and the attachment was successfully uploaded before sending. Check that your Messaging Profile is configured to receive media attachments. Some carriers or devices may strip media in transit. Test with a different device or carrier to isolate the issue. |
| Flask server not accessible from ngrok | ngrok reports "Connection refused" or "Failed to connect to localhost:5000". | Ensure Flask is running on port 5000 before starting ngrok. Verify no firewall is blocking port 5000. Check that Flask is listening on `0.0.0.0` (the default in `app.run()`). Restart both Flask and ngrok if the connection drops. |
| JSON decode error in webhook handler | The endpoint returns `{"error": "Invalid JSON"}` with HTTP 400. | Verify the Telnyx webhook is sending valid JSON in the request body. Check Flask logs for the exact error. Ensure your `Content-Type: application/json` header is being sent by Telnyx. If using a proxy or load balancer, confirm it's not modifying the request body. |

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
- [Build Two-Way SMS Conversations](/tutorials/sms/python/two-way-sms).
