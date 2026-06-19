# Long Code SMS with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that sends SMS messages using long codes (standard 10-digit phone numbers in the US) with the Telnyx Python SDK. This tutorial covers message queuing, delivery tracking via webhooks, rate limiting, and best practices for A2P (application-to-person) messaging on long codes. You'll implement a message queue system, handle inbound replies, and monitor delivery status in real time.

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
- A Telnyx long code (10-digit US phone number) enabled for outbound SMS.
- A publicly accessible URL for webhook callbacks (ngrok, Heroku, or similar for local testing).
- pip (Python package manager).
- Basic understanding of webhooks and HTTP POST requests.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-code-sms-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-code-sms-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, message queue, and webhook handlers:

```python
import os
import time
import telnyx
from datetime import datetime
from collections import defaultdict
from flask import Flask, jsonify, request
from config import Config

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
    try:
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
    
    except telnyx.APIStatusError as e:
        # Log failed message for retry
        message_status[queue_item["to"]] = {
            "status": "failed",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat(),
        }
        raise


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
        except Exception as e:
            failed += 1
            results.append({
                "to": queue_item["to"],
                "error": str(e),
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
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Rate limit error on queue | The endpoint returns `{"error": "Rate limit exceeded for +15559876543. Max 1 message per second."}` with HTTP 400. | The rate limiter enforces 1 message per second per recipient to prevent carrier throttling. Space out requests to the same number by at least 1 second, or use the `/sms/queue/process` endpoint to batch messages with delays between API calls. Adjust `RATE_LIMIT_PER_SECOND` in `config.py` if your use case requires higher throughput. |
| Webhook not receiving delivery updates | Messages send successfully but `/sms/status/<message_id>` returns 404 or shows "sent" status indefinitely. | Ensure your `WEBHOOK_URL` in `.env` is publicly accessible and points to your `/webhooks/message` endpoint. Configure the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) under Messaging > Webhooks. Test webhook delivery using ngrok (`ngrok http 5000`) and update `WEBHOOK_URL` to the ngrok URL. Verify that Telnyx can reach your server by checking firewall rules and ensuring the endpoint accepts POST requests. |
| Invalid phone number format | The endpoint returns `{"error": "Phone number must be in E.164 format (e.g., +15551234567)"}` with HTTP 400. | All phone numbers must use E.164 format: start with `+`, followed by country code and number without spaces, dashes, or parentheses. Example: `+15551234567` (US), `+447700900123` (UK), `+33123456789` (France). Update your request JSON to use properly formatted numbers. |
| Queue processing fails silently | Messages are queued successfully but `/sms/queue/process` returns `{"processed": 0, "failed": 0}` or shows errors without details. | Check the Flask console output for exception messages. Ensure `TELNYX_API_KEY` and `TELNYX_LONG_CODE` are correctly set in `.env`. Verify that your long code is enabled for outbound SMS in the Telnyx Portal. Test a single message with `/sms/send` to isolate whether the issue is with the queue or the API credentials. |

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
