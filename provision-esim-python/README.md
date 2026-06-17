# eSIM Provisioning with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that provisions eSIM profiles over-the-air using the Telnyx IoT API. This tutorial demonstrates how to manage eSIM lifecycle—from profile creation through activation and status monitoring—using the Telnyx Python SDK with proper error handling, webhook integration, and secure credential management.

eSIM provisioning enables remote, secure delivery of cellular profiles to IoT devices without physical SIM cards. You'll learn to create profiles, track activation status, handle webhook events, and manage device connectivity at scale.

## Who Is This For?

- **Python developers** building iot features with Flask.
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
- Access to the Telnyx IoT / SIM Management API (enabled by default).
- pip (Python package manager).
- A publicly accessible URL for webhook testing (ngrok or similar for local development).
- Basic understanding of REST APIs and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app/__init__.py` to initialize the Flask application and Telnyx client:

```python
import os
import telnyx
from flask import Flask
from dotenv import load_dotenv

load_dotenv()


def create_app():
    """Factory function to create and configure Flask app."""
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False
    
    # Initialize Telnyx client with the new SDK pattern
    app.telnyx_client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
    
    # Register blueprints
    from app.routes import esim_routes
    app.register_blueprint(esim_routes.bp)
    
    return app
```

Create `app/models/__init__.py` with helper functions for eSIM operations:

```python
"""eSIM provisioning models and utilities."""

import os
import telnyx


def create_esim_profile(client, device_name: str, sim_card_group_id: str) -> dict:
    """
    Create an eSIM profile for a device.
    
    Args:
        client: Telnyx client instance.
        device_name: Human-readable name for the device.
        sim_card_group_id: ID of the SIM card group to assign the profile to.
    
    Returns:
        Dictionary with profile details (id, iccid, status).
    
    Raises:
        telnyx.APIStatusError: If profile creation fails.
    """
    response = client.sim_cards.create(
        sim_card_group_id=sim_card_group_id,
        tags=[device_name],  # Use tags for device identification
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "created_at": str(response.data.created_at) if hasattr(response.data, "created_at") else None,
    }


def activate_esim_profile(client, sim_card_id: str) -> dict:
    """
    Activate an eSIM profile for network connectivity.
    
    Args:
        client: Telnyx client instance.
        sim_card_id: ID of the SIM card to activate.
    
    Returns:
        Dictionary with updated profile status.
    
    Raises:
        telnyx.APIStatusError: If activation fails.
    """
    response = client.sim_cards.activate(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }


def get_esim_profile(client, sim_card_id: str) -> dict:
    """
    Retrieve details of an eSIM profile.
    
    Args:
        client: Telnyx client instance.
        sim_card_id: ID of the SIM card to retrieve.
    
    Returns:
        Dictionary with profile details.
    
    Raises:
        telnyx.APIStatusError: If retrieval fails.
    """
    response = client.sim_cards.retrieve(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "tags": response.data.tags if hasattr(response.data, "tags") else [],
    }


def list_esim_profiles(client, sim_card_group_id: str = None, limit: int = 20) -> list:
    """
    List eSIM profiles, optionally filtered by SIM card group.
    
    Args:
        client: Telnyx client instance.
        sim_card_group_id: Optional filter by SIM card group ID.
        limit: Maximum number of profiles to return (default 20).
    
    Returns:
        List of profile dictionaries.
    
    Raises:
        telnyx.APIStatusError: If listing fails.
    """
    params = {"limit": limit}
    if sim_card_group_id:
        params["filter[sim_card_group_id]"] = sim_card_group_id
    
    response = client.sim_cards.list(**params)
    
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "sim_card_group_id": s.sim_card_group_id,
            "tags": s.tags if hasattr(s, "tags") else [],
        }
        for s in response.data
    ]
```

Create `app/routes/__init__.py` (empty file for package initialization):

```python
# Routes package
```

Create `app/routes/esim_routes.py` with Flask endpoints for eSIM provisioning:

```python
"""eSIM provisioning routes."""

import os
import telnyx
from flask import Blueprint, jsonify, request, current_app
from app.models import (
    create_esim_profile,
    activate_esim_profile,
    get_esim_profile,
    list_esim_profiles,
)

bp = Blueprint("esim", __name__, url_prefix="/esim")


@bp.route("/profiles", methods=["POST"])
def provision_esim():
    """
    Provision a new eSIM profile.
    
    Request body:
    {
        "device_name": "IoT-Device-001",
        "sim_card_group_id": "group-uuid-here"
    }
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    device_name = data.get("device_name")
    sim_card_group_id = data.get("sim_card_group_id")
    
    if not device_name or not sim_card_group_id:
        return jsonify({
            "error": "Missing required fields: 'device_name' and 'sim_card_group_id'"
        }), 400
    
    try:
        client = current_app.telnyx_client
        profile = create_esim_profile(client, device_name, sim_card_group_id)
        return jsonify(profile), 201
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@bp.route("/profiles/<sim_card_id>/activate", methods=["POST"])
def activate_esim(sim_card_id: str):
    """
    Activate an eSIM profile for network connectivity.
    
    Path parameter:
    - sim_card_id: UUID of the SIM card to activate.
    """
    if not sim_card_id:
        return jsonify({"error": "sim_card_id is required"}), 400
    
    try:
        client = current_app.telnyx_client
        profile = activate_esim_profile(client, sim_card_id)
        return jsonify(profile), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@bp.route("/profiles/<sim_card_id>", methods=["GET"])
def get_esim(sim_card_id: str):
    """
    Retrieve details of an eSIM profile.
    
    Path parameter:
    - sim_card_id: UUID of the SIM card to retrieve.
    """
    if not sim_card_id:
        return jsonify({"error": "sim_card_id is required"}), 400
    
    try:
        client = current_app.telnyx_client
        profile = get_esim_profile(client, sim_card_id)
        return jsonify(profile), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@bp.route("/profiles", methods=["GET"])
def list_esims():
    """
    List eSIM profiles with optional filtering.
    
    Query parameters:
    - sim_card_group_id: Optional filter by SIM card group.
    - limit: Maximum number of profiles to return (default 20, max 100).
    """
    sim_card_group_id = request.args.get("sim_card_group_id")
    limit = request.args.get("limit", default=20, type=int)
    
    # Validate limit to prevent excessive API calls
    if limit < 1 or limit > 100:
        return jsonify({"error": "limit must be between 1 and 100"}), 400
    
    try:
        client = current_app.telnyx_client
        profiles = list_esim_profiles(client, sim_card_group_id, limit)
        return jsonify(profiles), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@bp.route("/webhooks/sim-status", methods=["POST"])
def handle_sim_status_webhook():
    """
    Handle SIM card status change webhooks from Telnyx.
    
    Webhook event: sim_card.status.changed
    Payload includes: sim_card_id, status (active/inactive), timestamp.
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Webhook payload required"}), 400
    
    # Extract webhook metadata
    event_type = data.get("event_type")
    sim_card_id = data.get("data", {}).get("id")
    status = data.get("data", {}).get("status")
    
    # Log webhook event (in production, store in database)
    print(f"[WEBHOOK] Event: {event_type}, SIM: {sim_card_id}, Status: {status}")
    
    # Acknowledge receipt to Telnyx (prevents retries)
    return jsonify({"received": True}), 200
```

Create `app.py` as the entry point:

```python
#!/usr/bin/env python3
"""Production-ready Flask application for eSIM provisioning."""

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| SIM Card Group Not Found | You receive a 404 error or "sim_card_group_id not found" message. | Confirm the SIM card group ID exists in your Telnyx account. Navigate to the [Telnyx Portal](https://portal.telnyx.com) → IoT → SIM Card Groups and copy the exact UUID. Verify the ID is passed correctly in the request body. |
| Profile Activation Fails | Activation returns a 400 or 422 error with "invalid state" or "cannot activate". | Ensure the profile is in "ready" status before activation. Check the profile status using the GET endpoint. Some profiles may require additional setup (e.g., APN configuration) before activation. Consult the [Telnyx IoT documentation](https://developers.telnyx.com/docs/v2/iot) for prerequisites. |
| Webhook Not Received | Webhook endpoint is not being called by Telnyx. | Verify the webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal. Use ngrok to expose your local Flask server: `ngrok http 5000`. Ensure the endpoint returns HTTP 200 to acknowledge receipt. Check Telnyx Portal → Webhooks for delivery logs and retry attempts. |
| Rate Limit Exceeded (429) | Requests return `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. The Telnyx API allows 100 requests per second per API key. Batch operations where possible (e.g., list multiple profiles in one request). Add delays between rapid provisioning requests. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Card Data Usage](/tutorials/iot/python/data-usage-monitoring).
- [Activate SIM Cards at Scale](/tutorials/iot/python/sim-activation).
- [Handle SIM Status Webhooks](/tutorials/iot/python/sim-status-webhook).
