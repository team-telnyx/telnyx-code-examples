# Device Location with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that tracks SIM card device locations using the Telnyx IoT API. This tutorial demonstrates how to query SIM card network attachment data, retrieve location information from carrier networks, and expose location endpoints with proper error handling and security patterns.

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
- Active SIM cards in your Telnyx account with devices connected to carrier networks.
- pip (Python package manager).
- A tool like curl or Postman to test HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to retrieve SIM card data and location information:

```python
import os
import telnyx
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_sim_card_details(sim_card_id: str) -> dict:
    """Retrieve SIM card details including network attachment status."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "phone_number": response.data.phone_number,
        "imei": response.data.imei,
        "imsi": response.data.imsi,
    }


def get_sim_network_usage(sim_card_id: str) -> dict:
    """Fetch network usage data which includes carrier and network info."""
    # Network usage endpoint requires direct REST call via the SDK's HTTP client
    api_key = os.getenv("TELNYX_API_KEY")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    response = requests.get(url, headers=headers, timeout=10)
    
    if response.status_code == 401:
        raise telnyx.AuthenticationError("Invalid API key")
    elif response.status_code == 404:
        raise ValueError(f"SIM card {sim_card_id} not found")
    elif response.status_code == 429:
        raise telnyx.RateLimitError("Rate limit exceeded")
    elif response.status_code >= 400:
        raise telnyx.APIStatusError(f"API error: {response.status_code}")
    
    data = response.json()
    
    # Extract location-relevant fields from network usage
    if "data" in data and len(data["data"]) > 0:
        latest = data["data"][0]
        return {
            "carrier": latest.get("carrier"),
            "country": latest.get("country"),
            "network_type": latest.get("network_type"),
            "last_updated": latest.get("last_updated"),
            "data_limit": latest.get("data_limit"),
            "data_used": latest.get("data_used"),
        }
    
    return {
        "carrier": None,
        "country": None,
        "network_type": None,
        "last_updated": None,
        "data_limit": None,
        "data_used": None,
    }


def list_all_sim_cards() -> list:
    """List all SIM cards in the account with pagination support."""
    response = client.sim_cards.list()
    
    # Extract serializable data for each SIM card
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "phone_number": s.phone_number,
            "sim_card_group_id": s.sim_card_group_id,
        }
        for s in response.data
    ]
```

Now add Flask routes to expose device location endpoints:

```python
@app.route("/devices", methods=["GET"])
def list_devices():
    """List all SIM cards (devices) in the account."""
    try:
        devices = list_all_sim_cards()
        return jsonify({"devices": devices}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/devices/<sim_card_id>", methods=["GET"])
def get_device_location(sim_card_id: str):
    """Retrieve device location and network information for a specific SIM card."""
    try:
        # Validate SIM card ID format (basic check)
        if not sim_card_id or len(sim_card_id) < 5:
            return jsonify({"error": "Invalid SIM card ID format"}), 400
        
        # Fetch SIM card details
        sim_details = get_sim_card_details(sim_card_id)
        
        # Fetch network/location data
        network_data = get_sim_network_usage(sim_card_id)
        
        # Combine into location response
        location_response = {
            "device": sim_details,
            "location": {
                "carrier": network_data.get("carrier"),
                "country": network_data.get("country"),
                "network_type": network_data.get("network_type"),
                "last_updated": network_data.get("last_updated"),
            },
            "data_usage": {
                "limit_mb": network_data.get("data_limit"),
                "used_mb": network_data.get("data_used"),
            },
        }
        
        return jsonify(location_response), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": str(e)}), 404


@app.route("/devices/<sim_card_id>/location", methods=["GET"])
def get_location_only(sim_card_id: str):
    """Retrieve only location information for a device (lightweight endpoint)."""
    try:
        if not sim_card_id or len(sim_card_id) < 5:
            return jsonify({"error": "Invalid SIM card ID format"}), 400
        
        network_data = get_sim_network_usage(sim_card_id)
        
        location_response = {
            "sim_card_id": sim_card_id,
            "carrier": network_data.get("carrier"),
            "country": network_data.get("country"),
            "network_type": network_data.get("network_type"),
            "last_updated": network_data.get("last_updated"),
        }
        
        return jsonify(location_response), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": str(e)}), 404


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint to verify API connectivity."""
    try:
        # Attempt a lightweight API call to verify authentication
        client.sim_cards.list(page={"size": 1})
        return jsonify({"status": "healthy"}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"status": "unhealthy", "reason": "Invalid API key"}), 401
    except telnyx.APIConnectionError:
        return jsonify({"status": "unhealthy", "reason": "Cannot reach Telnyx API"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating the `.env` file. |
| SIM Card Not Found (404) | The endpoint returns `{"error": "SIM card {id} not found"}` when querying a device. | Confirm the SIM card ID is correct by listing all devices with `GET /devices`. Verify the SIM card exists in your Telnyx account and is not in a deleted state. Use the exact ID format returned from the list endpoint. |
| No Location Data Returned | The location fields (carrier, country, network_type) are all `null` in the response. | Location data is only available when a device is actively connected to a carrier network. Ensure your SIM card has an active device connected and has transmitted data recently. Network usage data is reported asynchronously; wait a few minutes after device connection before querying. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded"}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Implement exponential backoff in your client code and reduce the frequency of location queries. The default rate limit is 100 requests per minute per API key. |
| Network Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is reachable. Check if your firewall or proxy is blocking requests to `api.telnyx.com`. Temporarily disable VPN or proxy services and retry. |

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
- [Activate SIM Cards Programmatically](/tutorials/iot/python/sim-activation).
- [Configure Custom APN Settings](/tutorials/iot/python/apn-configuration).
