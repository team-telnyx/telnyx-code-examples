# Send Bulk SMS with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that sends SMS messages to multiple recipients efficiently using the Telnyx Python SDK. This tutorial demonstrates batch message processing, rate limiting, progress tracking, and comprehensive error handling for high-volume messaging scenarios. You'll learn how to structure bulk operations, manage API quotas, and provide real-time feedback on delivery status.

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
- Familiarity with Flask and REST APIs.
- A basic understanding of rate limiting and async patterns.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with bulk SMS functionality, rate limiting, and comprehensive error handling:

```python
import os
import time
import telnyx
from datetime import datetime
from typing import List, Dict, Any
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Configuration
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")
BULK_SMS_RATE_LIMIT = int(os.getenv("BULK_SMS_RATE_LIMIT", "10"))
BULK_SMS_DELAY = float(os.getenv("BULK_SMS_DELAY", "0.1"))


def validate_phone_number(phone: str) -> bool:
    """Validate phone number is in E.164 format."""
    return isinstance(phone, str) and phone.startswith("+") and len(phone) >= 10


def send_single_sms(to_number: str, message: str) -> Dict[str, Any]:
    """
    Send a single SMS message via Telnyx.
    
    Args:
        to_number: Recipient phone number in E.164 format.
        message: Message text to send.
    
    Returns:
        Dictionary with message_id, status, and recipient info.
    
    Raises:
        ValueError: If phone number format is invalid.
        telnyx exceptions: For API errors (caught in route handler).
    """
    if not validate_phone_number(to_number):
        raise ValueError(f"Invalid phone number format: {to_number}. Use E.164 format (e.g., +15551234567)")
    
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "to": to_number,
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "pending",
    }


def send_bulk_sms(recipients: List[str], message: str) -> Dict[str, Any]:
    """
    Send SMS to multiple recipients with rate limiting and error tracking.
    
    Args:
        recipients: List of phone numbers in E.164 format.
        message: Message text to send to all recipients.
    
    Returns:
        Dictionary with success/failure counts and detailed results.
    """
    if not recipients:
        raise ValueError("Recipients list cannot be empty")
    
    if not message or len(message.strip()) == 0:
        raise ValueError("Message text cannot be empty")
    
    if len(message) > 1600:
        raise ValueError("Message exceeds maximum length of 1600 characters")
    
    results = {
        "total": len(recipients),
        "successful": 0,
        "failed": 0,
        "messages": [],
        "errors": [],
        "started_at": datetime.utcnow().isoformat(),
    }
    
    # Process each recipient with rate limiting
    for idx, recipient in enumerate(recipients):
        try:
            # Validate before sending
            if not validate_phone_number(recipient):
                results["failed"] += 1
                results["errors"].append({
                    "recipient": recipient,
                    "error": "Invalid phone number format",
                })
                continue
            
            # Send message
            msg_result = send_single_sms(recipient, message)
            results["successful"] += 1
            results["messages"].append(msg_result)
            
            # Rate limiting: sleep between requests to avoid hitting API limits
            if idx < len(recipients) - 1:
                time.sleep(BULK_SMS_DELAY)
        
        except telnyx.RateLimitError:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": "Rate limit exceeded. Consider increasing BULK_SMS_DELAY.",
            })
        except telnyx.APIStatusError as e:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": f"API error: {str(e)}",
                "status_code": e.status_code,
            })
        except ValueError as e:
            results["failed"] += 1
            results["errors"].append({
                "recipient": recipient,
                "error": str(e),
            })
    
    results["completed_at"] = datetime.utcnow().isoformat()
    return results


@app.route("/sms/bulk/send", methods=["POST"])
def send_bulk_sms_endpoint():
    """HTTP endpoint to send bulk SMS messages."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    recipients = data.get("recipients", [])
    message = data.get("message")
    
    if not isinstance(recipients, list) or len(recipients) == 0:
        return jsonify({"error": "Missing or invalid 'recipients' field. Must be a non-empty list."}), 400
    
    if not message:
        return jsonify({"error": "Missing required field: 'message'"}), 400
    
    try:
        result = send_bulk_sms(recipients, message)
        return jsonify(result), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sms/bulk/status", methods=["GET"])
def bulk_sms_status():
    """Health check endpoint for bulk SMS service."""
    return jsonify({
        "service": "Telnyx Bulk SMS",
        "status": "operational",
        "rate_limit": BULK_SMS_RATE_LIMIT,
        "delay_between_messages": BULK_SMS_DELAY,
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Rate Limit Errors (429) | The endpoint returns `{"error": "Rate limit exceeded..."}` for some recipients during bulk send. | Increase the `BULK_SMS_DELAY` value in your `.env` file (e.g., from `0.1` to `0.5` seconds). This adds a pause between API calls. Alternatively, reduce `BULK_SMS_RATE_LIMIT` to send fewer messages per batch. Check your Telnyx account limits in the [Portal](https://portal.telnyx.com) to understand your quota. |
| Partial Failures in Bulk Send | Some recipients receive messages while others fail with API errors. | Review the `errors` array in the response to identify which recipients failed and why. Common causes: invalid phone number format, network issues, or account restrictions. Retry failed recipients separately after fixing the underlying issue. Ensure all phone numbers are in E.164 format (e.g., `+15551234567`). |
| Message Length Validation Error | The endpoint returns `{"error": "Message exceeds maximum length of 1600 characters"}`. | Reduce your message text to 1600 characters or fewer. Note that messages longer than 160 characters are automatically split into multiple SMS segments by Telnyx, and each segment is billed separately. Plan your message length accordingly. |
| Empty Recipients List | The endpoint returns `{"error": "Missing or invalid 'recipients' field. Must be a non-empty list."}`. | Ensure your JSON request includes a `recipients` field with at least one phone number in E.164 format. Example: `{"recipients": ["+15551234567"], "message": "Hello"}`. Verify the JSON is valid using a JSON validator. |
| Authentication Failure (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no leading/trailing spaces. If the key was recently regenerated, update your `.env` file and restart the Flask server. |

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
- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
