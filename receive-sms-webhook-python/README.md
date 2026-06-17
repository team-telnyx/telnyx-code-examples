# Receive SMS Webhook with Python and Flask

## What Does This Example Do?

Build a production-ready Flask webhook endpoint that receives inbound SMS messages from Telnyx. This tutorial demonstrates how to configure a Messaging Profile with a webhook URL, validate incoming requests, and process SMS events using the Telnyx Python SDK. You'll learn to handle the `message.received` webhook event and extract message data for storage or processing.

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
- A Telnyx phone number enabled for inbound SMS.
- pip (Python package manager).
- A publicly accessible URL (ngrok, Heroku, or similar) to expose your local Flask server for webhook testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define a helper function to process incoming SMS events and a Flask route to receive webhooks:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def process_inbound_sms(event_data: dict) -> dict:
    """
    Extract and validate inbound SMS data from webhook event.
    
    Args:
        event_data: The 'data' object from the webhook payload.
    
    Returns:
        Dictionary with extracted message details.
    """
    # Extract message attributes from the webhook event
    message_id = event_data.get("id")
    from_number = event_data.get("from", {}).get("phone_number")
    to_number = event_data.get("to", [{}])[0].get("phone_number")
    text = event_data.get("text", "")
    received_at = event_data.get("received_at")
    
    # Return JSON-serializable data
    return {
        "message_id": message_id,
        "from": from_number,
        "to": to_number,
        "text": text,
        "received_at": received_at,
    }
```

Add the webhook route to receive and process inbound SMS:

```python
@app.route("/webhooks/sms", methods=["POST"])
def receive_sms_webhook():
    """
    Webhook endpoint to receive inbound SMS from Telnyx.
    
    Telnyx sends a POST request with event type 'message.received' for inbound SMS.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "Empty request body"}), 400
    
    # Extract event metadata
    event_type = payload.get("type")
    event_data = payload.get("data", {})
    
    # Only process inbound SMS events
    if event_type != "message.received":
        return jsonify({"status": "ignored", "reason": f"Event type {event_type} not processed"}), 200
    
    try:
        # Process the inbound message
        message_info = process_inbound_sms(event_data)
        
        # Log or store the message (example: print to console)
        print(f"Received SMS from {message_info['from']}: {message_info['text']}")
        
        # Return 200 OK to acknowledge receipt to Telnyx
        return jsonify({
            "status": "received",
            "message_id": message_info["message_id"],
        }), 200
        
    except Exception as e:
        # Log the error but still return 200 to prevent Telnyx retries
        print(f"Error processing webhook: {str(e)}")
        return jsonify({"status": "error", "details": str(e)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | Your Flask endpoint is running but Telnyx is not sending webhook requests. | Verify the webhook URL in your Messaging Profile matches your public ngrok URL exactly (including the `/webhooks/sms` path). Ensure the URL is HTTPS, not HTTP. Check that **message.received** is selected in the webhook event subscriptions. Test the endpoint manually with curl to confirm it's accessible. |
| 404 Not Found on webhook URL | Telnyx returns a 404 error when attempting to deliver the webhook. | Confirm your Flask route is defined as `/webhooks/sms` and the HTTP method is POST. Verify your ngrok tunnel is active and the public URL is correct. Restart your Flask server after making route changes. Test the endpoint with curl from your terminal to ensure it responds with 200 OK. |
| Missing or null fields in event data | The `from`, `to`, or `text` fields are null or missing from the webhook payload. | Some webhook events may have incomplete data depending on the message type or carrier. Add defensive checks using `.get()` with default values (as shown in the code). Log the entire `event_data` to inspect the actual payload structure: `print(json.dumps(event_data, indent=2))`. |
| Environment variable not loaded | The application raises `AttributeError` or `TypeError` when accessing `os.getenv("TELNYX_API_KEY")`. | Ensure your `.env` file exists in the same directory as `app.py` and contains the `TELNYX_API_KEY` variable. Verify `load_dotenv()` is called at the top of your script before any `os.getenv()` calls. Check that the `.env` file is not named `.env.txt` or `env`. Restart the Flask server after updating the `.env` file. |

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

- [Send a Single SMS with Python and Flask](/tutorials/sms/python/send-single-sms).
- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
