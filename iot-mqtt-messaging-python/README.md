# MQTT Messaging with Python and Flask

## What Does This Example Do?

Build a Flask application that manages IoT SIM cards and publishes device data to MQTT brokers. This tutorial demonstrates SIM card management, data usage monitoring, and MQTT integration for real-time IoT communication using the Telnyx Python SDK.

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
- Active Telnyx IoT SIM cards.
- pip (Python package manager).
- An MQTT broker (local or cloud-based like AWS IoT Core or HiveMQ).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/iot-mqtt-messaging-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/iot-mqtt-messaging-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client with MQTT integration. Define helper functions for SIM management and MQTT publishing:

```python
import os
import json
import telnyx
import requests
from datetime import datetime
from dotenv import load_dotenv
import paho.mqtt.client as mqtt

load_dotenv()

# Initialize Telnyx client
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# MQTT configuration
MQTT_BROKER = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")


def get_mqtt_client():
    """Initialize and configure MQTT client."""
    mqtt_client = mqtt.Client()
    
    if MQTT_USERNAME and MQTT_PASSWORD:
        mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        return mqtt_client
    except Exception as e:
        raise ConnectionError(f"Failed to connect to MQTT broker: {str(e)}")


def get_sim_cards() -> list:
    """Retrieve all SIM cards and return JSON-serializable data."""
    response = client.sim_cards.list()
    
    return [
        {
            "id": sim.id,
            "iccid": sim.iccid,
            "status": sim.status,
            "sim_card_group_id": sim.sim_card_group_id,
            "tags": getattr(sim, 'tags', []),
        }
        for sim in response.data
    ]


def get_sim_data_usage(sim_card_id: str) -> dict:
    """Get data usage for a specific SIM card via REST API."""
    api_key = os.getenv("TELNYX_API_KEY")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        return {
            "sim_card_id": sim_card_id,
            "data_usage_mb": data.get("data", {}).get("total_mb", 0),
            "last_updated": datetime.utcnow().isoformat(),
        }
    else:
        raise ValueError(f"Failed to fetch data usage: {response.status_code}")


def publish_sim_status(sim_data: dict, mqtt_client) -> bool:
    """Publish SIM card status to MQTT topic."""
    topic = f"telnyx/iot/sim/{sim_data['iccid']}/status"
    payload = json.dumps({
        "sim_id": sim_data["id"],
        "iccid": sim_data["iccid"],
        "status": sim_data["status"],
        "timestamp": datetime.utcnow().isoformat(),
    })
    
    result = mqtt_client.publish(topic, payload, qos=1)
    return result.rc == mqtt.MQTT_ERR_SUCCESS
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-mqtt-messaging-python/app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| MQTT Connection Failed | The endpoint returns `{"error": "Failed to connect to MQTT broker: [Errno 111] Connection refused"}` with HTTP 503. | Verify your MQTT broker is running and accessible. Check the `MQTT_BROKER_HOST` and `MQTT_BROKER_PORT` in your `.env` file. For local testing, install Mosquitto broker with `sudo apt-get install mosquitto mosquitto-clients` or use a public broker like `test.mosquitto.org`. Ensure firewall rules allow the connection. |
| SIM Card Not Found | You receive a 404 error when trying to publish or get usage for a specific SIM card ID. | Confirm the SIM card ID exists by first calling the `/sims` endpoint to list all available SIM cards. Use the exact `id` field from the response, not the `iccid`. The SIM card must be associated with your Telnyx account and properly provisioned in the portal. |
| Data Usage API Returns 403 | The data usage endpoint fails with "Failed to fetch data usage: 403" when calling `/sims/{id}/usage`. | Ensure your Telnyx API key has the correct permissions for IoT SIM management. The SIM card must be active and have generated some network traffic. Data usage reporting may have a delay of up to 24 hours. Verify the SIM card is properly configured with the APN "internet.telnyx" in your device settings. |

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

- [Activate IoT SIM Cards](/tutorials/iot/python/sim-activation).
- [Monitor Data Usage with Webhooks](/tutorials/iot/python/data-usage-monitoring).
- [Handle SIM Status Webhooks](/tutorials/iot/python/sim-status-webhook).
