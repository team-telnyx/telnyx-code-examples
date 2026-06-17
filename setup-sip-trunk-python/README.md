# Set Up SIP Trunking with Python and Flask

## What Does This Example Do?

Build a production-ready Flask endpoint that sets up SIP trunking using the Telnyx Python SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **Python developers** building sip features with Flask.
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
- A Telnyx phone number enabled for outbound voice
- pip (Python package manager)

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define a helper function to handle SIP connection creation with proper validation:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(name: str, username: str, password: str) -> dict:
    """Create SIP connection via Telnyx and return JSON-serializable response data."""
    # Validate input to prevent API errors
    if not name or not username or not password:
        raise ValueError("Name, username, and password are required")
    
    # Use client.sip_connections.create() — NOT client.sip_connections.create()
    response = client.sip_connections.create(
        name=name,
        username=username,
        password=password,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "username": response.data.username,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

### Issue 1: Authentication Error (401)

**Problem:** The endpoint returns `{"error": "Invalid API key"}` with HTTP 401.

**Solution:** Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server.

### Issue 2: Invalid Input

**Problem:** You receive a 400 error stating "Missing required fields: 'name', 'username', and 'password'" or "Name, username, and password are required".

**Solution:** Ensure your request body contains all required fields (`name`, `username`, and `password`) and that they are not empty. Update your test curl command to include valid input.

### Issue 3: Environment Variable Not Set

**Problem:** The application raises `ValueError: TELNYX_API_KEY environment variable not set` on startup or first request.

**Solution:** Confirm your `.env` file exists in the same directory as `app.py` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `load_dotenv()` call must execute before `os.getenv()` is called—verify this import order in your code.

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

- [Configure Outbound SIP Calls](/tutorials/sip/python/outbound-sip-call)
- [Implement Inbound SIP Routing](/tutorials/sip/python/inbound-sip-routing)
- [Set Up SIP Authentication](/tutorials/sip/python/sip-authentication)
