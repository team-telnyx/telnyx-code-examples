# Build Two-Way SMS with Python and Flask

## What Does This Example Do?

Create a complete two-way SMS system using Flask and the Telnyx Python SDK. This tutorial demonstrates how to send outbound messages and receive inbound SMS via webhooks, enabling interactive conversations between your application and users.

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

- Python 3.8 or higher
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com)
- A Telnyx phone number enabled for SMS
- A publicly accessible URL for webhooks (use ngrok for local development)
- pip (Python package manager)

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application and webhook handler. The system stores conversation state in memory for demonstration:

```python
import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Simple in-memory storage for conversation state
conversations = {}


def send_sms(to_number: str, message: str) -> dict:
    """Send SMS via Telnyx and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format")
    
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "text": message,
    }


def process_inbound_message(from_number: str, message_text: str) -> str:
    """Process inbound SMS and generate appropriate response."""
    message_lower = message_text.lower().strip()
    
    # Initialize conversation state if new user
    if from_number not in conversations:
        conversations[from_number] = {
            "state": "new",
            "created_at": datetime.now(),
            "message_count": 0
        }
    
    conversation = conversations[from_number]
    conversation["message_count"] += 1
    conversation["last_message"] = datetime.now()
    
    # Simple conversation flow based on keywords
    if message_lower in ["hello", "hi", "hey", "start"]:
        conversation["state"] = "greeted"
        return "Hello! Welcome to Telnyx SMS. Type 'help' for available commands or 'info' to learn more about our services."
    
    elif message_lower == "help":
        return "Available commands:\n• 'info' - Learn about Telnyx\n• 'status' - Check your conversation stats\n• 'reset' - Start over\n• 'stop' - End conversation"
    
    elif message_lower == "info":
        conversation["state"] = "informed"
        return "Telnyx provides programmable SMS, Voice, and IoT connectivity APIs. Visit telnyx.com to get started with our developer-friendly platform!"
    
    elif message_lower == "status":
        return f"Conversation started: {conversation['created_at'].strftime('%Y-%m-%d %H:%M')}\nMessages exchanged: {conversation['message_count']}\nCurrent state: {conversation['state']}"
    
    elif message_lower == "reset":
        conversations[from_number] = {
            "state": "reset",
            "created_at": datetime.now(),
            "message_count": 1
        }
        return "Conversation reset! Type 'hello' to start fresh."
    
    elif message_lower in ["stop", "quit", "end"]:
        conversation["state"] = "ended"
        return "Thanks for trying Telnyx SMS! Conversation ended. Text 'hello' anytime to start again."
    
    else:
        # Echo back with helpful suggestion
        return f"You said: '{message_text}'\n\nI didn't understand that command. Type 'help' to see available options."
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

### Issue 1: Webhooks Not Received

**Problem:** Your Flask app doesn't receive webhook events when SMS messages are sent to your Telnyx number.

**Solution:** Verify your Messaging Profile configuration in the Telnyx Portal. Ensure the webhook URL matches your ngrok HTTPS URL exactly (including `/webhooks/sms` path). Check that `message.received` events are enabled. Test the webhook URL directly with a POST request to confirm Flask is receiving requests. If using ngrok, ensure it's still running and the URL hasn't changed.

### Issue 2: Webhook Authentication Errors

**Problem:** The webhook endpoint returns 401 errors or "Authentication failed" when processing inbound messages.

**Solution:** Webhook requests don't require API key authentication - they're incoming from Telnyx. The authentication error likely occurs when your app tries to send the response SMS. Verify your `TELNYX_API_KEY` environment variable is correctly set and the API key is valid. Check that the Flask server restarted after updating the `.env` file.

### Issue 3: Response Messages Not Sending

**Problem:** Inbound messages are received and processed, but the automated responses aren't delivered to users.

**Solution:** Check the Flask logs for specific error messages from the `send_sms()` function. Verify your `TELNYX_PHONE_NUMBER` environment variable is set and matches a number assigned to your Messaging Profile. Ensure the phone number is in E.164 format. Test the `/sms/send` endpoint directly to isolate whether the issue is with webhook processing or SMS sending functionality.

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

- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms)
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa)
- [Create SMS Survey System](/tutorials/sms/python/sms-survey)
