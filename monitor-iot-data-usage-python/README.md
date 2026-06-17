# Data Usage Monitoring with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that monitors SIM card data usage in real time using the Telnyx IoT API. This tutorial demonstrates how to retrieve data consumption metrics, set up alerts when SIMs approach data limits, and expose monitoring endpoints for dashboard integration. You'll learn the new client-based SDK pattern, proper error handling for IoT operations, and secure credential management.

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
- A Telnyx account with active SIM cards from the [Telnyx Portal](https://portal.telnyx.com).
- At least one SIM card in your account with active data service.
- pip (Python package manager).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define helper functions to fetch SIM data usage and calculate consumption metrics:

```python
import os
import telnyx
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

DATA_LIMIT_THRESHOLD_MB = int(os.getenv("DATA_LIMIT_THRESHOLD_MB", "500"))


def get_sim_card_details(sim_card_id: str) -> dict:
    """Retrieve SIM card information and return JSON-serializable data."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "phone_number": response.data.phone_number,
    }


def list_all_sim_cards() -> list:
    """List all SIM cards in the account and return JSON-serializable data."""
    response = client.sim_cards.list()
    
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "sim_card_group_id": s.sim_card_group_id,
            "phone_number": s.phone_number,
        }
        for s in response.data
    ]


def get_data_usage(sim_card_id: str) -> dict:
    """
    Fetch data usage for a SIM card via REST endpoint.
    Returns usage in MB and calculates percentage of limit.
    """
    api_key = os.getenv("TELNYX_API_KEY")
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    data = response.json()
    usage_bytes = data.get("data", {}).get("total_usage_bytes", 0)
    usage_mb = usage_bytes / (1024 * 1024)
    
    # Calculate percentage of threshold
    percentage = (usage_mb / DATA_LIMIT_THRESHOLD_MB * 100) if DATA_LIMIT_THRESHOLD_MB > 0 else 0
    
    return {
        "sim_card_id": sim_card_id,
        "usage_mb": round(usage_mb, 2),
        "usage_bytes": usage_bytes,
        "threshold_mb": DATA_LIMIT_THRESHOLD_MB,
        "percentage_of_limit": round(percentage, 1),
        "alert_triggered": usage_mb >= DATA_LIMIT_THRESHOLD_MB,
        "timestamp": datetime.utcnow().isoformat(),
    }


def check_sim_data_health(sim_card_id: str) -> dict:
    """
    Comprehensive health check combining SIM details and data usage.
    Returns a single object with all monitoring data.
    """
    sim_details = get_sim_card_details(sim_card_id)
    usage_data = get_data_usage(sim_card_id)
    
    return {
        "sim": sim_details,
        "usage": usage_data,
        "health_status": "warning" if usage_data["alert_triggered"] else "healthy",
    }
```

Now add Flask routes to expose the monitoring endpoints:

```python
from flask import Flask, jsonify, request
import requests

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring infrastructure."""
    return jsonify({"status": "ok", "service": "data-usage-monitor"}), 200


@app.route("/sim-cards", methods=["GET"])
def list_sims():
    """List all SIM cards in the account."""
    try:
        sims = list_all_sim_cards()
        return jsonify({"data": sims, "count": len(sims)}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>", methods=["GET"])
def get_sim(sim_card_id: str):
    """Retrieve details for a specific SIM card."""
    try:
        sim = get_sim_card_details(sim_card_id)
        return jsonify(sim), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/usage", methods=["GET"])
def get_usage(sim_card_id: str):
    """Get data usage metrics for a specific SIM card."""
    try:
        usage = get_data_usage(sim_card_id)
        return jsonify(usage), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "Failed to fetch usage data"}), 500
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/health", methods=["GET"])
def check_health(sim_card_id: str):
    """Get comprehensive health status for a SIM card."""
    try:
        health = check_sim_data_health(sim_card_id)
        return jsonify(health), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "Failed to fetch health data"}), 500
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/activate", methods=["POST"])
def activate_sim(sim_card_id: str):
    """Activate a SIM card."""
    try:
        response = client.sim_cards.activate(sim_card_id)
        
        return jsonify({
            "id": response.data.id,
            "status": response.data.status,
            "message": "SIM card activated successfully",
        }), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/webhooks/sim-events", methods=["POST"])
def handle_sim_webhook():
    """
    Handle incoming SIM card events from Telnyx webhooks.
    Events include: sim_card.status.changed, sim_card.data_limit.reached
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    event_type = data.get("type")
    event_data = data.get("data", {})
    
    # Log the event (in production, store in database)
    print(f"[{datetime.utcnow().isoformat()}] Event: {event_type}")
    print(f"SIM Card ID: {event_data.get('id')}")
    print(f"Status: {event_data.get('status')}")
    
    # Handle specific event types
    if event_type == "sim_card.status.changed":
        sim_id = event_data.get("id")
        new_status = event_data.get("status")
        print(f"SIM {sim_id} status changed to {new_status}")
        
    elif event_type == "sim_card.data_limit.reached":
        sim_id = event_data.get("id")
        print(f"ALERT: SIM {sim_id} has reached its data limit")
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| SIM Card Not Found (404) | You receive `{"error": "SIM card not found"}` when querying a specific SIM ID. | Confirm the SIM card ID is correct by running `curl http://localhost:5000/sim-cards` to list all available SIM cards. Copy the exact `id` value from the response and use it in subsequent requests. Verify the SIM card has not been deleted from your account. |
| Data Usage Endpoint Returns 500 | The `/usage` endpoint fails with `{"error": "Failed to fetch usage data"}`. | Ensure the SIM card has active data service enabled in the Telnyx Portal. Data usage is reported asynchronously—if a SIM was recently activated, wait 5–10 minutes before querying usage. Check that your API key has permissions to access the network usage endpoint. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded"}` with HTTP 429. | You are making too many API requests in a short time. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Consider caching SIM card data for 60 seconds to reduce API calls. Check the Telnyx documentation for current rate limits. |
| Environment Variable Not Set | The application raises `KeyError` or `TypeError` when accessing `os.getenv()` values. | Confirm your `.env` file exists in the same directory as `app.py` and contains all required variables: `TELNYX_API_KEY`, `DATA_LIMIT_THRESHOLD_MB`, and `WEBHOOK_SECRET`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `load_dotenv()` call must execute before any `os.getenv()` calls—verify this import order in your code. |

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

- [Activate and Manage SIM Cards](/tutorials/iot/python/sim-activation).
- [Configure APN Settings for IoT Devices](/tutorials/iot/python/apn-configuration).
- [Handle SIM Status Change Webhooks](/tutorials/iot/python/sim-status-webhook).
