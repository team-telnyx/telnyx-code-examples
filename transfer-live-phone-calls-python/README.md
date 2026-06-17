# Call Transfer with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that initiates outbound calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, proper handling of call state via webhooks, and secure credential management for telecom applications.

## Who Is This For?

- **Python developers** building voice features with Flask.
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
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with its Connection ID.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage call state and transfer logic:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for active calls (use a database in production)
active_calls = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using Call Control
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    # Extract call_control_id from response — this is returned by the API
    call_control_id = response.data.call_control_id
    
    # Store call metadata for later transfer operations
    active_calls[call_control_id] = {
        "call_control_id": call_control_id,
        "from": from_number,
        "to": to_number,
        "status": "initiated",
    }
    
    return {
        "call_control_id": call_control_id,
        "from": from_number,
        "to": to_number,
        "status": "initiated",
    }


def transfer_call(call_control_id: str, transfer_to: str) -> dict:
    """Transfer an active call to another number."""
    if not transfer_to.startswith("+"):
        raise ValueError("Transfer number must be in E.164 format")
    
    if call_control_id not in active_calls:
        raise ValueError(f"Call {call_control_id} not found or already completed")
    
    # Execute the transfer action
    response = client.calls.actions.transfer(
        call_control_id=call_control_id,
        to=transfer_to,
    )
    
    # Update call state
    active_calls[call_control_id]["status"] = "transferred"
    active_calls[call_control_id]["transferred_to"] = transfer_to
    
    return {
        "call_control_id": call_control_id,
        "status": "transferred",
        "transferred_to": transfer_to,
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    if call_control_id not in active_calls:
        raise ValueError(f"Call {call_control_id} not found")
    
    # Hangup the call
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    # Update call state
    active_calls[call_control_id]["status"] = "hangup"
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup",
    }
```

Add Flask routes to handle call initiation, transfer, and webhook events:

```python
@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """HTTP endpoint to initiate an outbound call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    try:
        result = initiate_call(to_number)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/transfer", methods=["POST"])
def transfer_call_endpoint():
    """HTTP endpoint to transfer an active call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    call_control_id = data.get("call_control_id")
    transfer_to = data.get("transfer_to")
    
    if not call_control_id or not transfer_to:
        return jsonify({"error": "Missing required fields: 'call_control_id' and 'transfer_to'"}), 400
    
    try:
        result = transfer_call(call_control_id, transfer_to)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/hangup", methods=["POST"])
def hangup_call_endpoint():
    """HTTP endpoint to terminate a call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    call_control_id = data.get("call_control_id")
    
    if not call_control_id:
        return jsonify({"error": "Missing required field: 'call_control_id'"}), 400
    
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """Webhook endpoint to receive call state change events from Telnyx."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    # Extract event metadata
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log the event (in production, persist to a database)
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Update call state based on event type
    if event_type == "call.initiated":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.hangup":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "completed"
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/status/<call_control_id>", methods=["GET"])
def get_call_status(call_control_id):
    """HTTP endpoint to retrieve the status of a call."""
    if call_control_id not in active_calls:
        return jsonify({"error": "Call not found"}), 404
    
    return jsonify(active_calls[call_control_id]), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating the `.env` file. |
| Call Not Found on Transfer | You receive `{"error": "Call ... not found or already completed"}` when attempting to transfer. | Ensure the `call_control_id` from the initiate response is used exactly in the transfer request. The call must be in an active state (answered) before transfer is possible. Check that the call has received a `call.answered` webhook event before attempting transfer. |
| Webhook Events Not Received | The `/webhooks/call-events` endpoint is not being called by Telnyx. | Verify that your Call Control Application in the Telnyx Portal is configured with the correct webhook URL: `{WEBHOOK_URL}/webhooks/call-events`. Ensure ngrok is running and the forwarding URL matches your `.env` file. Check Flask server logs for incoming POST requests. Test webhook delivery using the Telnyx Portal's webhook testing tool. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests to use properly formatted numbers. |
| Connection ID Not Set | The application raises `ValueError: TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set`. | Confirm your `.env` file contains both `TELNYX_CONNECTION_ID` and `TELNYX_PHONE_NUMBER`. The Connection ID is your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` and is in the same directory as `app.py`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Build an IVR Menu with Python](/tutorials/voice/python/ivr-menu).
- [Record Calls with Python](/tutorials/voice/python/call-recording).
- [Create a Conference Call with Python](/tutorials/voice/python/conference-call).
