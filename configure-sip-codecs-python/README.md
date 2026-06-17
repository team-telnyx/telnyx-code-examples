# Codec Configuration with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that configures and manages SIP codec settings for your Telnyx SIP trunk. This tutorial demonstrates how to create SIP connections with specific codec preferences, retrieve existing configurations, and update codec settings to optimize voice quality and compatibility with your PBX or SBC. You'll learn to handle the Telnyx SIP Trunking API with proper error handling and secure credential management.

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
- A SIP-capable PBX, SBC, or softphone (Asterisk, FreeSWITCH, 3CX, or similar).
- pip (Python package manager).
- Basic understanding of SIP and codec concepts (G.711, G.729, Opus).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/configure-sip-codecs-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/configure-sip-codecs-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage SIP codec configurations:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection_with_codecs(
    name: str,
    codecs: list,
    username: str = None,
    password: str = None,
    sip_endpoint: str = None,
) -> dict:
    """
    Create a SIP connection with specified codec preferences.
    
    Args:
        name: Friendly name for the SIP connection.
        codecs: List of codec names in priority order (e.g., ["G.711", "G.729"]).
        username: SIP username for credential authentication.
        password: SIP password for credential authentication.
        sip_endpoint: SIP endpoint address (e.g., sip.example.com:5060).
    
    Returns:
        Dictionary with connection details and codec configuration.
    """
    if not username:
        username = os.getenv("SIP_USERNAME")
    if not password:
        password = os.getenv("SIP_PASSWORD")
    if not sip_endpoint:
        sip_endpoint = os.getenv("SIP_ENDPOINT")
    
    if not all([username, password, sip_endpoint]):
        raise ValueError("SIP credentials and endpoint are required")
    
    # Map codec names to Telnyx codec identifiers
    codec_map = {
        "G.711": "PCMU",
        "G.729": "G729",
        "Opus": "OPUS",
        "PCMU": "PCMU",
        "PCMA": "PCMA",
    }
    
    # Validate and normalize codec list
    normalized_codecs = []
    for codec in codecs:
        if codec not in codec_map:
            raise ValueError(f"Unsupported codec: {codec}. Supported: {list(codec_map.keys())}")
        normalized_codecs.append(codec_map[codec])
    
    # Create SIP connection with codec preferences
    response = client.sip_connections.create(
        connection_name=name,
        outbound_voice_profile_id=None,  # Optional: link to outbound profile
        inbound_sip_credentials=[
            {
                "username": username,
                "password": password,
            }
        ],
        inbound_addresses=[sip_endpoint],
        codec_configurations=[
            {
                "codec": codec,
                "priority": idx,
            }
            for idx, codec in enumerate(normalized_codecs)
        ],
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": username,
        "sip_endpoint": sip_endpoint,
        "codecs": normalized_codecs,
        "created_at": str(response.data.created_at) if hasattr(response.data, "created_at") else None,
    }


def get_sip_connection_codecs(connection_id: str) -> dict:
    """
    Retrieve codec configuration for an existing SIP connection.
    
    Args:
        connection_id: The ID of the SIP connection.
    
    Returns:
        Dictionary with connection details and current codec settings.
    """
    response = client.sip_connections.retrieve(connection_id)
    
    # Extract codec configuration from the response
    codecs = []
    if hasattr(response.data, "codec_configurations") and response.data.codec_configurations:
        codecs = [
            {
                "codec": c.get("codec") if isinstance(c, dict) else getattr(c, "codec", None),
                "priority": c.get("priority") if isinstance(c, dict) else getattr(c, "priority", None),
            }
            for c in response.data.codec_configurations
        ]
    
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "codecs": codecs,
        "inbound_addresses": response.data.inbound_addresses if hasattr(response.data, "inbound_addresses") else [],
    }


def list_sip_connections() -> list:
    """
    List all SIP connections with their codec configurations.
    
    Returns:
        List of dictionaries containing connection details.
    """
    response = client.sip_connections.list()
    
    connections = []
    for conn in response.data:
        codecs = []
        if hasattr(conn, "codec_configurations") and conn.codec_configurations:
            codecs = [
                {
                    "codec": c.get("codec") if isinstance(c, dict) else getattr(c, "codec", None),
                    "priority": c.get("priority") if isinstance(c, dict) else getattr(c, "priority", None),
                }
                for c in conn.codec_configurations
            ]
        
        connections.append({
            "id": conn.id,
            "name": conn.connection_name,
            "codecs": codecs,
        })
    
    return connections
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Unsupported Codec Error | You receive a 400 error stating "Unsupported codec" when creating a connection. | Verify that the codec names in your request match the supported list: `G.711`, `G.729`, `Opus`, `PCMU`, or `PCMA`. Check the spelling and capitalization exactly. The codec list is case-sensitive and must match the codec_map dictionary in the helper function. |
| Missing SIP Credentials | The application raises `ValueError: SIP credentials and endpoint are required` when creating a connection. | Ensure your `.env` file contains `SIP_USERNAME`, `SIP_PASSWORD`, and `SIP_ENDPOINT` variables, or pass these values explicitly in the POST request body. Verify the `.env` file exists in the same directory as `app.py` and that `load_dotenv()` is called before accessing environment variables. |
| Connection Not Found (404) | Retrieving a connection returns a 404 error or "Connection not found" message. | Verify the `connection_id` in the URL path is correct and matches an existing SIP connection. Use the GET `/sip/connections` endpoint to list all connections and confirm the ID. Connection IDs are UUIDs in the format `12345678-1234-1234-1234-123456789012`. |
| Codec Configuration Not Applied | The codec configuration is created but not reflected in the SIP connection. | Confirm that your PBX or SBC supports the configured codecs. Some older equipment may not support Opus or G.729. Test codec negotiation by initiating a call and checking the SIP INVITE message in your PBX logs to verify which codec was selected during the handshake. |

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

- [Set Up SIP Trunking with Telnyx](/tutorials/sip/python/sip-trunking-setup).
- [Configure SIP Authentication Methods](/tutorials/sip/python/sip-authentication).
- [Implement Failover Routing for SIP Connections](/tutorials/sip/python/failover-routing).
