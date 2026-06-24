# CNAM Lookup with Python and Flask

## What Does This Example Do?

Build a Flask API that performs CNAM (Caller ID Name) lookups using the Telnyx SIP Trunking API. This tutorial demonstrates how to retrieve caller name information for phone numbers, essential for identifying inbound callers in SIP trunking applications.

## Who Is This For?

- **Python developers** building sip features with Flask.
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
- pip (Python package manager)
- Basic understanding of REST APIs

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Since CNAM lookup uses a direct REST endpoint, we'll implement both SDK-based SIP connection management and direct HTTP calls for CNAM:

```python
import os
import requests
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def lookup_cnam(phone_number: str) -> dict:
    """Perform CNAM lookup for a phone number via Telnyx REST API."""
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise ValueError("TELNYX_API_KEY environment variable not set")
    
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Remove the + prefix for the API endpoint
    clean_number = phone_number[1:]
    
    url = f"https://api.telnyx.com/v2/cnam_lookups/{clean_number}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 401:
        raise ValueError("Invalid API key")
    elif response.status_code == 404:
        raise ValueError("Phone number not found or CNAM data unavailable")
    elif response.status_code != 200:
        raise ValueError(f"API error: {response.status_code} - {response.text}")
    
    data = response.json()
    
    return {
        "phone_number": phone_number,
        "caller_name": data.get("data", {}).get("caller_name"),
        "country_code": data.get("data", {}).get("country_code"),
        "phone_number_type": data.get("data", {}).get("phone_number_type"),
        "carrier_name": data.get("data", {}).get("carrier_name")
    }


def get_sip_connections() -> list:
    """Retrieve SIP connections for reference."""
    response = client.sip_connections.list()
    return [
        {
            "id": c.id,
            "name": c.name,
            "username": c.username,
            "status": getattr(c, 'status', 'unknown')
        }
        for c in response.data
    ]
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-python/app.py) for the full implementation.

## Troubleshooting

### Issue 1: Phone Number Not Found (404)

**Problem:** The CNAM lookup returns `{"error": "Phone number not found or CNAM data unavailable"}` with a 404 status.

**Solution:** CNAM data is not available for all phone numbers, especially international numbers or newly issued numbers. Verify the phone number is a valid US/Canada number in E.164 format. Some mobile carriers and VoIP providers may not have CNAM records. Try testing with a known landline number first.

### Issue 2: Invalid API Key Error

**Problem:** The endpoint returns `{"error": "Invalid API key"}` when making CNAM lookup requests.

**Solution:** Verify your `TELNYX_API_KEY` in the `.env` file is correct and has the necessary permissions for CNAM lookups. Check the [Telnyx Portal](https://portal.telnyx.com) to ensure your API key hasn't been regenerated or revoked. Restart the Flask server after updating the environment file.

### Issue 3: Rate Limiting on CNAM Requests

**Problem:** Multiple rapid CNAM lookup requests result in HTTP 429 errors or timeouts.

**Solution:** Implement request throttling in your application to avoid hitting rate limits. Add a delay between requests or implement a caching mechanism to store recent CNAM results. Consider batching lookups if you need to process multiple numbers. The Telnyx API has rate limits to ensure service quality for all users.

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking Configuration](/tutorials/sip/python/sip-trunking-setup)
- [Configure SIP Authentication Methods](/tutorials/sip/python/sip-authentication)
- [Handle Inbound SIP Call Routing](/tutorials/sip/python/inbound-sip-routing)
