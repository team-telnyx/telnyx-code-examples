# SIP Registration with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that manages SIP connections and handles registration with Telnyx. This tutorial demonstrates creating SIP connections with credential authentication, configuring endpoints for your PBX or softphone, and monitoring registration status through a web interface.

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

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Basic understanding of SIP (Session Initiation Protocol) concepts.
- A SIP client (softphone, PBX, or SBC) for testing registration.
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage SIP connections with proper validation:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(connection_name: str, username: str, password: str) -> dict:
    """Create a new SIP connection with credential authentication."""
    if not connection_name or not username or not password:
        raise ValueError("Connection name, username, and password are required")
    
    # Create SIP connection with credential authentication
    response = client.sip_connections.create(
        connection_name=connection_name,
        user_name=username,
        password=password,
        # Enable credential authentication (username/password)
        sip_uri_calling_preference="telnyx",
        # Configure for standard SIP registration
        transport_protocol="UDP",
        default_on_hold_comfort_noise_enabled=True,
        dtmf_type="RFC 2833",
        encode_contact_header_enabled=False,
        encrypted_media="SRTP",
        onnet_t38_passthrough_enabled=False,
        webhook_event_url="",
        webhook_event_failover_url="",
        webhook_api_version="1",
        webhook_timeout_secs=25,
        rtcp_settings={
            "port": "rtp+1",
            "capture_enabled": False,
            "report_frequency_secs": 5
        }
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "connection_name": response.data.connection_name,
        "user_name": response.data.user_name,
        "sip_uri": f"sip:{response.data.user_name}@{os.getenv('SIP_DOMAIN')}",
        "status": "created",
        "transport_protocol": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media
    }


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve SIP connection details by ID."""
    response = client.sip_connections.retrieve(connection_id)
    
    return {
        "id": response.data.id,
        "connection_name": response.data.connection_name,
        "user_name": response.data.user_name,
        "sip_uri": f"sip:{response.data.user_name}@{os.getenv('SIP_DOMAIN')}",
        "transport_protocol": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media,
        "created_at": response.data.created_at,
        "updated_at": response.data.updated_at
    }


def list_sip_connections() -> list:
    """List all SIP connections for the account."""
    response = client.sip_connections.list()
    
    return [
        {
            "id": c.id,
            "connection_name": c.connection_name,
            "user_name": c.user_name,
            "sip_uri": f"sip:{c.user_name}@{os.getenv('SIP_DOMAIN')}",
            "transport_protocol": c.transport_protocol,
            "created_at": c.created_at
        }
        for c in response.data
    ]
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-python/app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` when creating SIP connections. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes around the key. If you recently regenerated the API key, update your environment file and restart the Flask server. |
| SIP Registration Fails | Your SIP client cannot register with the created connection credentials. | Confirm your SIP client is configured with the exact username and password from the connection creation response. Verify the SIP server is set to `sip.telnyx.com` with UDP transport on port 5060. Check that your firewall allows outbound UDP traffic on port 5060 and the RTP port range (typically 10000-20000). |
| Connection Not Found (404) | GET requests to `/sip/connections/{id}` return 404 errors for valid connection IDs. | Ensure you're using the correct connection ID from the creation response. The ID should be a string of digits, not the username. Verify the connection was created successfully by checking the POST response or listing all connections with GET `/sip/connections`. If the connection was deleted, recreate it using the POST endpoint. |

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

- [Configure Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/python/outbound-sip-call).
- [Set Up Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/python/inbound-sip-routing).
- [Implement SIP Authentication Methods](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/python/sip-authentication).
