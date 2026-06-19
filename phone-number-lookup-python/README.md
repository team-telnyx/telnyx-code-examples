# Number Lookup with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that performs phone number lookups using the Telnyx Number Lookup API. This tutorial demonstrates how to retrieve detailed information about phone numbers, including carrier details, line type, and number portability status. You'll learn to handle API responses, implement caching for performance, and build a web interface to query numbers in real time.

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
- pip (Python package manager).
- Basic familiarity with Flask and REST APIs.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, number lookup logic, and a simple in-memory cache:

```python
import os
import telnyx
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Simple in-memory cache for lookup results
lookup_cache = {}
CACHE_TTL = timedelta(hours=24)


def is_cache_valid(cached_entry: dict) -> bool:
    """Check if a cached entry is still valid based on TTL."""
    if not cached_entry:
        return False
    cached_time = cached_entry.get("cached_at")
    if not cached_time:
        return False
    return datetime.utcnow() - cached_time < CACHE_TTL


def get_cached_lookup(phone_number: str) -> dict:
    """Retrieve a lookup result from cache if valid."""
    if phone_number in lookup_cache:
        entry = lookup_cache[phone_number]
        if is_cache_valid(entry):
            return entry.get("data")
    return None


def cache_lookup_result(phone_number: str, result: dict) -> None:
    """Store a lookup result in cache with timestamp."""
    lookup_cache[phone_number] = {
        "data": result,
        "cached_at": datetime.utcnow(),
    }


def lookup_phone_number(phone_number: str) -> dict:
    """
    Perform a number lookup via Telnyx API.
    Returns JSON-serializable lookup data including carrier and line type.
    """
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Check cache first
    cached_result = get_cached_lookup(phone_number)
    if cached_result:
        cached_result["from_cache"] = True
        return cached_result
    
    # Call Telnyx Number Lookup API
    response = client.number_lookup.retrieve(phone_number)
    
    # Extract serializable data from SDK response
    lookup_data = {
        "phone_number": response.data.phone_number,
        "country_code": response.data.country_code,
        "carrier": {
            "name": response.data.carrier.name if response.data.carrier else None,
            "type": response.data.carrier.type if response.data.carrier else None,
        },
        "line_type": response.data.line_type,
        "number_type": response.data.number_type,
        "portability": {
            "status": response.data.portability.status if response.data.portability else None,
            "last_checked_at": response.data.portability.last_checked_at if response.data.portability else None,
        },
        "from_cache": False,
    }
    
    # Cache the result
    cache_lookup_result(phone_number, lookup_data)
    
    return lookup_data
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid format. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on number lookup requests. Implement exponential backoff in your client code and space out requests. The in-memory cache in this tutorial helps reduce redundant lookups—verify that caching is enabled and working by checking the `from_cache` field in responses. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is reachable. Check your firewall or proxy settings if behind a corporate network. Temporarily disable any VPN and retry. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for service outages. |
| Cache Not Working | Lookups always return `"from_cache": false` even for repeated numbers. | Verify that the `CACHE_TTL` is set to a reasonable value (default is 24 hours). Check that the `lookup_cache` dictionary is being populated by adding debug logging. Ensure you are using the same phone number format (with `+` prefix) in repeated requests. |

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
- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
