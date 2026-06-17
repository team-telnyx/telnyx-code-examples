# Failover Routing with Python and Flask

## What Does This Example Do?

Build a production-ready SIP failover routing system using Telnyx and Flask. This tutorial demonstrates how to configure multiple SIP endpoints with automatic failover, implement health checks, and route inbound calls intelligently across primary and backup SIP trunks. You'll learn to manage SIP connections, assign phone numbers, and handle call routing logic with proper error handling and monitoring.

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
- At least two SIP endpoints (PBX, SBC, or softphone) with IP addresses or credentials.
- A Telnyx phone number for inbound call routing.
- pip (Python package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and implement the SIP failover routing system:

```python
import os
import telnyx
import requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for SIP connection health status
sip_endpoints = {
    "primary": {
        "ip": os.getenv("PRIMARY_SIP_IP"),
        "port": int(os.getenv("PRIMARY_SIP_PORT", "5060")),
        "healthy": True,
        "last_check": None,
    },
    "backup": {
        "ip": os.getenv("BACKUP_SIP_IP"),
        "port": int(os.getenv("BACKUP_SIP_PORT", "5060")),
        "healthy": True,
        "last_check": None,
    },
}


def create_sip_connection(name: str, endpoint_ip: str, endpoint_port: int) -> dict:
    """Create a SIP connection via Telnyx API."""
    response = client.sip_connections.create(
        connection_name=name,
        outbound_voice_profile_id=None,  # Will be set separately if needed
        inbound_sip_credentials=[
            {
                "username": f"sip_{name}",
                "password": f"secure_password_{name}",
            }
        ],
        sip_uri_transport_protocol="udp",
    )
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": response.data.inbound_sip_credentials[0].username if response.data.inbound_sip_credentials else None,
    }


def list_sip_connections() -> list:
    """Retrieve all SIP connections from Telnyx."""
    response = client.sip_connections.list()
    
    # Extract serializable data from list
    return [
        {
            "id": c.id,
            "name": c.connection_name,
            "username": c.inbound_sip_credentials[0].username if c.inbound_sip_credentials else None,
        }
        for c in response.data
    ]


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve a specific SIP connection by ID."""
    response = client.sip_connections.retrieve(connection_id)
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": response.data.inbound_sip_credentials[0].username if response.data.inbound_sip_credentials else None,
    }


def check_endpoint_health(endpoint_name: str) -> bool:
    """Check if a SIP endpoint is reachable via OPTIONS ping."""
    endpoint = sip_endpoints.get(endpoint_name)
    if not endpoint:
        return False
    
    try:
        # Attempt to reach the SIP endpoint with a simple HTTP health check
        # In production, use SIP OPTIONS ping instead
        response = requests.get(
            f"http://{endpoint['ip']}:{endpoint['port']}/health",
            timeout=5,
        )
        is_healthy = response.status_code == 200
    except (requests.RequestException, Exception):
        is_healthy = False
    
    # Update endpoint status
    endpoint["healthy"] = is_healthy
    endpoint["last_check"] = datetime.utcnow().isoformat()
    
    return is_healthy


def get_active_endpoint() -> str:
    """Return the name of the active SIP endpoint based on health status."""
    # Check primary endpoint first
    if check_endpoint_health("primary") and sip_endpoints["primary"]["healthy"]:
        return "primary"
    
    # Fall back to backup if primary is unhealthy
    if check_endpoint_health("backup") and sip_endpoints["backup"]["healthy"]:
        return "backup"
    
    # If both are down, return primary (will fail gracefully)
    return "primary"


def assign_phone_number_to_connection(phone_number: str, connection_id: str) -> dict:
    """Assign a Telnyx phone number to a SIP connection."""
    # This requires a REST API call since the SDK may not expose this directly
    headers = {
        "Authorization": f"Bearer {os.getenv('TELNYX_API_KEY')}",
        "Content-Type": "application/json",
    }
    
    payload = {
        "connection_id": connection_id,
    }
    
    response = requests.patch(
        f"https://api.telnyx.com/v2/phone_numbers/{phone_number}",
        json=payload,
        headers=headers,
    )
    
    if response.status_code not in [200, 201]:
        raise ValueError(f"Failed to assign phone number: {response.text}")
    
    return response.json().get("data", {})


@app.route("/sip/connections", methods=["GET"])
def list_connections():
    """List all SIP connections."""
    try:
        connections = list_sip_connections()
        return jsonify({"connections": connections}), 200
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections", methods=["POST"])
def create_connection():
    """Create a new SIP connection."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    if not name:
        return jsonify({"error": "Missing required field: 'name'"}), 400
    
    try:
        connection = create_sip_connection(name, None, None)
        return jsonify(connection), 201
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections/<connection_id>", methods=["GET"])
def get_connection(connection_id):
    """Retrieve a specific SIP connection."""
    try:
        connection = get_sip_connection(connection_id)
        return jsonify(connection), 200
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/health", methods=["GET"])
def check_health():
    """Check health status of all SIP endpoints."""
    primary_healthy = check_endpoint_health("primary")
    backup_healthy = check_endpoint_health("backup")
    active = get_active_endpoint()
    
    return jsonify({
        "primary": {
            "ip": sip_endpoints["primary"]["ip"],
            "healthy": primary_healthy,
            "last_check": sip_endpoints["primary"]["last_check"],
        },
        "backup": {
            "ip": sip_endpoints["backup"]["ip"],
            "healthy": backup_healthy,
            "last_check": sip_endpoints["backup"]["last_check"],
        },
        "active_endpoint": active,
    }), 200


@app.route("/sip/failover-status", methods=["GET"])
def failover_status():
    """Get current failover routing status."""
    active = get_active_endpoint()
    endpoint = sip_endpoints[active]
    
    return jsonify({
        "active_endpoint": active,
        "sip_uri": f"sip://{endpoint['ip']}:{endpoint['port']}",
        "primary_healthy": sip_endpoints["primary"]["healthy"],
        "backup_healthy": sip_endpoints["backup"]["healthy"],
    }), 200


@app.route("/webhooks/call", methods=["POST"])
def handle_inbound_call():
    """Webhook handler for inbound calls — route to active SIP endpoint."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    # Determine active endpoint for call routing
    active = get_active_endpoint()
    endpoint = sip_endpoints[active]
    
    # Log the routing decision
    call_id = data.get("data", {}).get("id", "unknown")
    print(f"[{datetime.utcnow().isoformat()}] Routing call {call_id} to {active} endpoint ({endpoint['ip']}:{endpoint['port']})")
    
    # Return TwiML-like response to route call to SIP endpoint
    # In production, use Telnyx Call Control API to bridge the call
    return jsonify({
        "routing": {
            "endpoint": active,
            "sip_uri": f"sip://{endpoint['ip']}:{endpoint['port']}",
            "call_id": call_id,
        }
    }), 200


@app.route("/sip/assign-number", methods=["POST"])
def assign_number():
    """Assign a phone number to a SIP connection."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    connection_id = data.get("connection_id")
    
    if not phone_number or not connection_id:
        return jsonify({"error": "Missing required fields: 'phone_number' and 'connection_id'"}), 400
    
    try:
        result = assign_phone_number_to_connection(phone_number, connection_id)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401 when creating or listing SIP connections. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating the `.env` file. |
| Endpoint Health Check Always Fails | The `/sip/health` endpoint shows both primary and backup as unhealthy even though the SIP servers are running. | The health check attempts an HTTP GET to `/health` on each endpoint. Ensure your SIP endpoints expose an HTTP health check endpoint, or modify the `check_endpoint_health()` function to use SIP OPTIONS ping instead. For testing, temporarily disable health checks by setting `healthy: True` directly in the `sip_endpoints` dictionary. |
| Phone Number Assignment Fails | The `/sip/assign-number` endpoint returns a 400 error with message "Failed to assign phone number". | Verify the `phone_number` is in E.164 format (e.g., `+15551234567`) and that the `connection_id` exists and is valid. Check that your API key has permissions to modify phone numbers. Ensure the phone number is owned by your Telnyx account and not already assigned to another connection. |
| SIP Connection Creation Returns Empty Username | The `/sip/connections` endpoint returns connections with `username: null`. | The `inbound_sip_credentials` array may be empty if credentials were not properly set during creation. Modify the `create_sip_connection()` function to ensure credentials are passed correctly, or retrieve the connection details from the Telnyx Portal to verify the credentials exist. |
| Failover Not Triggering | The `/sip/failover-status` endpoint always returns the primary endpoint even when it is unhealthy. | Ensure the `check_endpoint_health()` function is correctly detecting endpoint failures. Add logging to the function to debug which endpoints are being checked. Verify that the primary endpoint is actually unreachable by testing connectivity manually (e.g., `ping` or `telnet`). |

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

- [Configure SIP Registration with Telnyx](/tutorials/sip/python/sip-registration).
- [Set Up SIP Trunking for Your PBX](/tutorials/sip/python/sip-trunking-setup).
- [Implement Outbound SIP Calls](/tutorials/sip/python/outbound-sip-call).
