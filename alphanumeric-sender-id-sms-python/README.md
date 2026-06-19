# Alphanumeric Sender Id with Python and Flask

## What Does This Example Do?

Build a Flask application that sends SMS messages using alphanumeric sender IDs instead of phone numbers. Alphanumeric sender IDs allow you to brand your messages with a company name or identifier (e.g., "ACME Corp" instead of a phone number), improving brand recognition and customer trust. This tutorial covers configuring a Messaging Profile, validating sender IDs, and handling regional restrictions with proper error handling.

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
- A Telnyx Messaging Profile configured with an alphanumeric sender ID (non-US/CA regions).
- pip (Python package manager).
- Understanding of SMS regional restrictions (alphanumeric IDs not supported in US/Canada).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/alphanumeric-sender-id-sms-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/alphanumeric-sender-id-sms-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Telnyx client initialization and helper functions for alphanumeric SMS sending:

```python
import os
import re
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def validate_alphanumeric_sender_id(sender_id: str) -> bool:
    """Validate alphanumeric sender ID format (max 11 chars, alphanumeric only)."""
    if not sender_id or len(sender_id) > 11:
        return False
    # Allow letters, numbers, and spaces (some regions allow spaces)
    return bool(re.match(r"^[A-Za-z0-9\s]+$", sender_id))


def validate_recipient_number(to_number: str) -> bool:
    """Validate recipient phone number is in E.164 format."""
    return bool(to_number.startswith("+") and len(to_number) >= 10)


def send_sms_with_alphanumeric_id(
    to_number: str, message: str, sender_id: str = None
) -> dict:
    """
    Send SMS using alphanumeric sender ID.
    
    Args:
        to_number: Recipient phone number in E.164 format (e.g., +447700900123).
        message: SMS message text.
        sender_id: Alphanumeric sender ID (uses env default if not provided).
    
    Returns:
        Dictionary with message ID, status, and sender info.
    
    Raises:
        ValueError: If validation fails.
    """
    # Use provided sender_id or fall back to environment variable
    if sender_id is None:
        sender_id = os.getenv("ALPHANUMERIC_SENDER_ID")
    
    if not sender_id:
        raise ValueError("ALPHANUMERIC_SENDER_ID not configured")
    
    # Validate sender ID format
    if not validate_alphanumeric_sender_id(sender_id):
        raise ValueError(
            f"Invalid sender ID '{sender_id}'. Must be 1-11 alphanumeric characters."
        )
    
    # Validate recipient number
    if not validate_recipient_number(to_number):
        raise ValueError(
            f"Invalid recipient number '{to_number}'. Must be in E.164 format (e.g., +447700900123)."
        )
    
    # Warn about regional restrictions
    if to_number.startswith("+1"):
        raise ValueError(
            "Alphanumeric sender IDs are not supported for US/Canada (+1) numbers. "
            "Use a phone number instead."
        )
    
    # Get Messaging Profile ID from environment
    messaging_profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID")
    if not messaging_profile_id:
        raise ValueError("TELNYX_MESSAGING_PROFILE_ID environment variable not set")
    
    # Create message with alphanumeric sender ID
    response = client.messages.create(
        from_=sender_id,
        to=to_number,
        text=message,
        messaging_profile_id=messaging_profile_id,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": sender_id,
        "to": to_number,
        "direction": response.data.direction,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Invalid Sender ID Error | The endpoint returns `{"error": "Invalid sender ID 'ACMECORP123'. Must be 1-11 alphanumeric characters."}` with HTTP 400. | Verify your sender ID is 1–11 characters long and contains only letters, numbers, and spaces. Remove special characters like hyphens, underscores, or punctuation. Test with the `/sms/validate-sender-id` endpoint first to confirm format before sending. |
| Alphanumeric Not Supported for US/Canada | You receive `{"error": "Alphanumeric sender IDs are not supported for US/Canada (+1) numbers..."}` when sending to a US number. | Alphanumeric sender IDs are only supported for non-US/Canada recipients. For US/Canada messaging, use a phone number in E.164 format (e.g., `+15551234567`) as the `from_` parameter instead. Update your recipient number to a supported region (e.g., UK: `+447700900123`, EU: `+33123456789`). |
| Messaging Profile Not Found | The API returns a 404 error or `{"error": "Messaging Profile not found"}` with HTTP 404. | Verify your `TELNYX_MESSAGING_PROFILE_ID` in the `.env` file matches a valid Messaging Profile UUID from the [Telnyx Portal](https://portal.telnyx.com) under Messaging > Profiles. Ensure the Messaging Profile is configured with an alphanumeric sender ID and is active. Copy the exact UUID from the Portal and restart the Flask server. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Confirm your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces, quotes, or line breaks. If the key was recently regenerated, update your `.env` file and restart the Flask server. |
| Invalid Recipient Number Format | You receive `{"error": "Invalid recipient number '447700900123'. Must be in E.164 format..."}` with HTTP 400. | Ensure all recipient phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+447700900123` (UK) or `+33123456789` (France). Update your test curl command to use properly formatted numbers. |

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
- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
