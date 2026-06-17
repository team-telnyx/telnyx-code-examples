# Inbound SIP Routing with Python and Flask

## What Does This Example Do?

Build a Flask application that manages inbound SIP routing configurations using the Telnyx SIP Trunking API. This tutorial demonstrates how to create SIP connections, configure routing rules, and handle inbound calls through your PBX or SIP endpoint with proper error handling and secure credential management.

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

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A publicly accessible SIP endpoint (PBX, SBC, or softphone) for receiving calls.
- pip (Python package manager).
- Basic understanding of SIP protocol concepts.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage SIP connections and routing configurations:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(name: str, sip_uri: str, username: str = None, password: str = None) -> dict:
    """Create a new SIP connection for inbound routing."""
    connection_params = {
        "connection_name": name,
        "transport_protocol": "UDP",
        "default_on_hold_comfort_noise_enabled": True,
        "dtmf_type": "RFC 2833",
        "encode_contact_header_enabled": False,
        "encrypted_media": "SRTP",
        "onnet_t38_passthrough_enabled": False,
        "webhook_event_url": "",
        "webhook_event_failover_url": "",
        "webhook_api_version": "1",
        "webhook_timeout_secs": 25,
        "rtcp_settings": {
            "port": "rtp+1"
        }
    }
    
    # Configure authentication method based on provided credentials
    if username and password:
        # Credential-based authentication
        connection_params.update({
            "sip_uri": sip_uri,
            "sip_username": username,
            "sip_password": password,
            "auth_username": username
        })
    else:
        # IP-based authentication (no registration required)
        connection_params.update({
            "sip_uri": sip_uri,
            "auth_username": "",
            "sip_username": "",
            "sip_password": ""
        })
    
    response = client.sip_connections.create(**connection_params)
    
    # Extract serializable data from SDK response
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "sip_uri": response.data.sip_uri,
        "username": response.data.sip_username,
        "status": "created",
        "auth_method": "credential" if username else "ip"
    }


def list_sip_connections() -> list:
    """Retrieve all SIP connections with routing information."""
    response = client.sip_connections.list()
    
    return [
        {
            "id": connection.id,
            "name": connection.connection_name,
            "sip_uri": connection.sip_uri,
            "username": connection.sip_username,
            "transport": connection.transport_protocol,
            "encrypted_media": connection.encrypted_media
        }
        for connection in response.data
    ]


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve detailed information about a specific SIP connection."""
    response = client.sip_connections.retrieve(connection_id)
    
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "sip_uri": response.data.sip_uri,
        "username": response.data.sip_username,
        "transport": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media,
        "dtmf_type": response.data.dtmf_type,
        "webhook_url": response.data.webhook_event_url,
        "rtcp_settings": response.data.rtcp_settings
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| SIP Connection Creation Fails | The API returns a 422 error when creating a SIP connection, indicating invalid parameters or configuration. | Verify that your SIP URI follows the correct format: `sip:hostname:port` or `sip:ip_address:port`. Ensure the hostname or IP address is publicly accessible from Telnyx servers. Check that the transport protocol (UDP/TCP/TLS) matches your SIP endpoint configuration. If using credential authentication, confirm the username and password are valid for your PBX. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` when making API calls to manage SIP connections. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes around the API key. If the key was recently regenerated, update your environment file and restart the Flask server. Check that the API key has the necessary permissions for SIP connection management. |
| Inbound Calls Not Routing | SIP connection is created successfully but inbound calls are not reaching your PBX or SIP endpoint. | Confirm your SIP endpoint is publicly accessible and listening on the specified port. Test connectivity using SIP debugging tools like `sipsak` or `sipgrep`. Verify firewall rules allow inbound SIP traffic on UDP port 5060 (or your custom port). Check that your PBX is configured to accept calls from Telnyx IP ranges. Ensure the SIP connection is properly associated with your Telnyx phone numbers through the portal or API. |

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

- [Configure SIP Authentication Methods](/tutorials/sip/python/sip-authentication).
- [Set Up Outbound SIP Calling](/tutorials/sip/python/outbound-sip-call).
- [Implement SIP Failover Routing](/tutorials/sip/python/failover-routing).
