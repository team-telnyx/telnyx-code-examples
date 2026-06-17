# Build an SMS Autoresponder with Python and Flask

## What Does This Example Do?

Create a production-ready SMS autoresponder that automatically replies to incoming messages using Telnyx webhooks and the Python SDK. This tutorial demonstrates webhook handling, message processing, and intelligent response generation with proper error handling and security practices.

## Who Is This For?

- **Python developers** building sms features with Flask.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for voice, messaging, SIP, AI, and IoT — no Frankenstack required.

- **Integrated platform** — Voice, SMS, SIP trunking, AI assistants, and IoT SIM management under one roof. No stitching together multiple vendors.
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
cd telnyx-code-examples/sms-auto-reply-bot-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the autoresponder logic. The system will analyze incoming messages and generate contextual responses:

```python
import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import re
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def generate_response(incoming_message: str, sender_number: str) -> str:
    """Generate contextual response based on incoming message content."""
    message_lower = incoming_message.lower().strip()
    
    # Business hours check
    current_hour = datetime.now().hour
    is_business_hours = 9 <= current_hour <= 17
    
    # Keyword-based responses
    if any(word in message_lower for word in ['help', 'support', 'assistance']):
        if is_business_hours:
            return "Hi! Our support team is available now. Please call (555) 123-4567 or visit our website for immediate assistance."
        else:
            return "Thanks for reaching out! Our support hours are 9 AM - 5 PM. We'll respond first thing tomorrow morning."
    
    elif any(word in message_lower for word in ['hours', 'open', 'closed']):
        return "We're open Monday-Friday 9 AM to 5 PM EST. Weekend hours: Saturday 10 AM - 2 PM. Closed Sundays."
    
    elif any(word in message_lower for word in ['price', 'cost', 'pricing', 'quote']):
        return "Thanks for your interest in our pricing! Please visit our website or call (555) 123-4567 to speak with our sales team for a custom quote."
    
    elif any(word in message_lower for word in ['location', 'address', 'where']):
        return "We're located at 123 Main Street, Anytown, ST 12345. Free parking available. Need directions? Check our website!"
    
    elif message_lower in ['stop', 'unsubscribe', 'opt out']:
        return "You've been unsubscribed from our messages. Reply START to opt back in. Thanks!"
    
    elif message_lower in ['start', 'subscribe', 'opt in']:
        return "Welcome! You're now subscribed to our updates. Reply STOP anytime to unsubscribe."
    
    else:
        # Default response for unrecognized messages
        if is_business_hours:
            return "Thanks for your message! A team member will respond shortly. For immediate help, call (555) 123-4567."
        else:
            return "Thanks for contacting us! We'll respond during business hours (9 AM - 5 PM EST). For urgent matters, visit our website."


def send_auto_reply(to_number: str, message: str) -> dict:
    """Send automated SMS reply and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "text": message,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

### Issue 1: Webhooks Not Received

**Problem:** The Flask server is running but no webhook events are being received when SMS messages are sent to your Telnyx number.

**Solution:** Verify your Messaging Profile configuration in the Telnyx Portal. Ensure the webhook URL matches your ngrok HTTPS URL exactly (including `/webhooks/sms` path). Check that the `message.received` event is enabled and your phone number is assigned to the correct profile. Test the webhook URL directly with curl to confirm it's accessible.

### Issue 2: Duplicate Responses Sent

**Problem:** The autoresponder sends multiple replies to the same incoming message, creating a loop or spam situation.

**Solution:** Add message deduplication logic by storing processed message IDs in memory or a database. Check the webhook payload for the `message_id` field and skip processing if already handled. Also verify your Messaging Profile doesn't have multiple webhook URLs configured that could trigger duplicate events.

### Issue 3: Response Generation Fails

**Problem:** The `generate_response()` function raises exceptions or returns empty responses, causing the webhook to fail.

**Solution:** Add input validation to handle edge cases like empty messages, non-text content, or special characters. Implement fallback responses for when keyword matching fails. Consider adding logging to track which messages trigger which response paths. Ensure the datetime module is properly imported for business hours logic.

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

- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook)
- [Build Two-Way SMS Conversations](/tutorials/sms/python/two-way-sms)
- [Implement SMS-Based Surveys](/tutorials/sms/python/sms-survey)
