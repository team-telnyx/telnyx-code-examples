# MMS Send with Python and Flask

## What Does This Example Do?

Build a production-ready Flask endpoint that sends MMS messages with media attachments using the Telnyx Python SDK. This tutorial demonstrates how to extend the SMS pattern to support multimedia content, handle multiple media URLs, validate file types, and implement robust error handling for media delivery at scale.

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
- A Telnyx phone number enabled for outbound MMS.
- pip (Python package manager).
- Publicly accessible URLs for media files (images, videos, or documents).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define a helper function to validate media URLs and send MMS with proper error handling:

```python
import os
import telnyx
from dotenv import load_dotenv
from urllib.parse import urlparse

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Supported media types for MMS
SUPPORTED_MEDIA_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/quicktime", "video/mpeg",
    "audio/mpeg", "audio/wav", "audio/ogg",
    "application/pdf", "application/msword",
}


def validate_media_url(url: str) -> bool:
    """Validate that URL is properly formatted and accessible."""
    try:
        result = urlparse(url)
        # Ensure URL has scheme and netloc
        return all([result.scheme in ("http", "https"), result.netloc])
    except Exception:
        return False


def send_mms(to_number: str, message: str, media_urls: list) -> dict:
    """Send MMS via Telnyx with media attachments and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format to prevent API errors
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Validate media URLs
    if not media_urls:
        raise ValueError("At least one media URL is required for MMS")
    
    if len(media_urls) > 10:
        raise ValueError("Maximum 10 media files per MMS message")
    
    for url in media_urls:
        if not validate_media_url(url):
            raise ValueError(f"Invalid media URL format: {url}")
    
    # Use client.messages.create() with media_urls parameter for MMS
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
        media_urls=media_urls,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
        "from": from_number,
        "to": to_number,
        "media_count": len(media_urls),
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Invalid Media URL Format | You receive a 400 error stating "Invalid media URL format" or the MMS fails to send. | Ensure all media URLs are publicly accessible and use `http://` or `https://` scheme. Test the URL in your browser to confirm it loads. Verify the URL is not behind authentication or a firewall. Use direct links to media files, not HTML pages. |
| Media File Not Supported | The API returns an error about unsupported media type or the MMS is rejected. | Confirm your media files are in supported formats: JPEG, PNG, GIF, WebP for images; MP4, MOV, MPEG for video; MP3, WAV, OGG for audio; PDF or DOC for documents. Verify file size is under 5 MB per attachment. Some carriers may have additional restrictions—test with a standard JPEG image first. |
| Missing Required Fields | The endpoint returns `{"error": "Missing required fields: 'to' and 'message'"}` with HTTP 400. | Ensure your JSON request body includes both `to` (recipient phone number in E.164 format) and `message` (text content). The `media_urls` field is required and must be a non-empty list. Example: `{"to": "+15559876543", "message": "Hello", "media_urls": ["https://example.com/image.jpg"]}`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For bulk MMS, space requests at least 100ms apart. Monitor your usage in the [Telnyx Portal](https://portal.telnyx.com) to understand your rate limit tier. |

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
