# SIM Activation with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that activates SIM cards using the Telnyx IoT API. This tutorial demonstrates how to retrieve SIM card details, activate SIMs with proper validation, handle telecom-specific errors, and manage credentials securely. You'll create endpoints to list SIM cards and activate them individually, with comprehensive error handling for production resilience.

## Who Is This For?

- **Python developers** building iot features with Flask.
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
- At least one SIM card provisioned in your Telnyx account.
- pip (Python package manager).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define helper functions to list and activate SIM cards with proper validation and error handling:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def list_sim_cards() -> list:
    """Retrieve all SIM cards and return JSON-serializable list."""
    response = client.sim_cards.list()
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return [
        {
            "id": sim.id,
            "iccid": sim.iccid,
            "status": sim.status,
            "sim_card_group_id": sim.sim_card_group_id,
        }
        for sim in response.data
    ]


def get_sim_card(sim_card_id: str) -> dict:
    """Retrieve a single SIM card by ID and return JSON-serializable data."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    # Extract serializable data from the response object
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }


def activate_sim_card(sim_card_id: str) -> dict:
    """Activate a SIM card and return JSON-serializable response data."""
    if not sim_card_id:
        raise ValueError("SIM card ID is required")
    
    # Call the activate method with the SIM card ID
    response = client.sim_cards.activate(sim_card_id)
    
    # Extract serializable data from the response object
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }
```

Now add Flask routes with comprehensive error handling:

```python
from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route("/sim-cards", methods=["GET"])
def list_sims():
    """HTTP endpoint to list all SIM cards."""
    try:
        sims = list_sim_cards()
        return jsonify({"data": sims}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>", methods=["GET"])
def get_sim(sim_card_id):
    """HTTP endpoint to retrieve a single SIM card."""
    try:
        sim = get_sim_card(sim_card_id)
        return jsonify(sim), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/activate", methods=["POST"])
def activate_sim(sim_card_id):
    """HTTP endpoint to activate a SIM card."""
    try:
        result = activate_sim_card(sim_card_id)
        return jsonify({"message": "SIM card activated successfully", "data": result}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| SIM Card Not Found (404) | You receive a 404 error or "SIM card not found" message when retrieving or activating a SIM. | Confirm the SIM card ID is correct by first running the `/sim-cards` endpoint to list all available SIM cards. Copy the exact `id` value from the response and use it in subsequent requests. Verify the SIM card exists in your Telnyx account via the Portal. |
| Environment Variable Not Set | The application raises an error about missing `TELNYX_API_KEY` on startup or first request. | Confirm your `.env` file exists in the same directory as `app.py` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `load_dotenv()` call must execute before `os.getenv()` is called—verify this import order in your code. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Implement exponential backoff in your client code and retry requests after a delay. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limits and contact support if you need higher limits. |
| Network Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is active and stable. Check that the Telnyx API endpoint is reachable by testing with `curl https://api.telnyx.com/v2/sim_cards` (you may get a 401, which is expected). If the issue persists, the Telnyx service may be temporarily unavailable—check the [Telnyx status page](https://status.telnyx.com). |

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
- [Configure Custom APN Settings](/tutorials/iot/python/apn-configuration).
- [Handle SIM Status Change Webhooks](/tutorials/iot/python/sim-status-webhook).
