# Call Recording with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that initiates outbound calls and records them using the Telnyx Voice API. This tutorial demonstrates how to use the Call Control API to dial calls, manage recording lifecycle, and handle webhook events for call state changes. You'll learn to securely manage credentials, implement proper error handling for telecom APIs, and process asynchronous call events.

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
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible webhook URL (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage call initiation and recording:

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

# In-memory store for call state (use a database in production)
call_state = {}


def initiate_call_with_recording(to_number: str) -> dict:
    """
    Initiate an outbound call and prepare for recording.
    Returns call_control_id for subsequent control actions.
    """
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    if not connection_id:
        raise ValueError("TELNYX_CONNECTION_ID environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using Call Control API
    # connection_id is the Call Control Application ID (static config)
    # call_control_id is returned in the response (per-call runtime value)
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    # Store call metadata for webhook processing
    call_state[call_control_id] = {
        "to": to_number,
        "from": from_number,
        "status": "initiated",
        "recording_id": None,
    }
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
        "to": to_number,
        "from": from_number,
    }


def start_recording(call_control_id: str) -> dict:
    """Start recording an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    # Start recording with dual channel (both sides of the call)
    response = client.calls.actions.start_recording(
        call_control_id=call_control_id,
        format="wav",
        channels="dual",
    )
    
    # Extract recording ID from response
    recording_id = response.data.recording_id if hasattr(response.data, "recording_id") else None
    call_state[call_control_id]["recording_id"] = recording_id
    
    return {
        "call_control_id": call_control_id,
        "recording_id": recording_id,
        "status": "recording",
    }


def stop_recording(call_control_id: str) -> dict:
    """Stop recording an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    response = client.calls.actions.stop_recording(call_control_id=call_control_id)
    
    return {
        "call_control_id": call_control_id,
        "status": "recording_stopped",
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    call_state[call_control_id]["status"] = "hangup_requested"
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup_requested",
    }
```

Now add Flask routes to handle call initiation, recording control, and webhook events:

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
        result = initiate_call_with_recording(to_number)
        return jsonify(result), 200
        
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


@app.route("/calls/<call_control_id>/recording/start", methods=["POST"])
def start_recording_endpoint(call_control_id):
    """HTTP endpoint to start recording an active call."""
    try:
        result = start_recording(call_control_id)
        return jsonify(result), 200
        
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


@app.route("/calls/<call_control_id>/recording/stop", methods=["POST"])
def stop_recording_endpoint(call_control_id):
    """HTTP endpoint to stop recording an active call."""
    try:
        result = stop_recording(call_control_id)
        return jsonify(result), 200
        
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


@app.route("/calls/<call_control_id>/hangup", methods=["POST"])
def hangup_endpoint(call_control_id):
    """HTTP endpoint to terminate an active call."""
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
        
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


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """
    Webhook endpoint to receive call state change events from Telnyx.
    Automatically starts recording when call is answered.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log the event for debugging
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Handle call.answered event — automatically start recording
    if event_type == "call.answered" and call_control_id:
        if call_control_id in call_state:
            call_state[call_control_id]["status"] = "answered"
            
            # Automatically start recording when call is answered
            try:
                start_recording(call_control_id)
                print(f"Recording started for call {call_control_id}")
            except Exception as e:
                print(f"Failed to start recording: {e}")
    
    # Handle call.hangup event — clean up state
    elif event_type == "call.hangup" and call_control_id:
        if call_control_id in call_state:
            call_state[call_control_id]["status"] = "hangup"
    
    # Handle call.recording.saved event — recording is ready
    elif event_type == "call.recording.saved" and call_control_id:
        if call_control_id in call_state:
            recording_url = payload.get("data", {}).get("recording_url")
            call_state[call_control_id]["recording_url"] = recording_url
            print(f"Recording saved for call {call_control_id}: {recording_url}")
    
    # Return 200 OK to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/<call_control_id>/status", methods=["GET"])
def get_call_status(call_control_id):
    """HTTP endpoint to retrieve call status and recording info."""
    if call_control_id not in call_state:
        return jsonify({"error": "Call not found"}), 404
    
    return jsonify(call_state[call_control_id]), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Connection ID Not Found | The application raises `ValueError: TELNYX_CONNECTION_ID environment variable not set` or the API returns a 422 error about invalid connection. | Confirm your `.env` file contains `TELNYX_CONNECTION_ID` with the correct Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to a Call Control application—verify it exists and is active in the Portal under Voice > Call Control Applications. |
| Webhook Events Not Received | Recording does not start automatically, or webhook endpoint is never called. | Ensure your Flask server is publicly accessible via ngrok or a production domain. Update the webhook URL in your Call Control Application settings in the Telnyx Portal to point to `https://your-domain/webhooks/call-events`. Verify the URL is reachable by testing with curl from another machine. Check Flask logs for incoming POST requests. |
| Recording Not Starting | Call connects but recording never begins, or `start_recording()` returns an error. | Verify the call has reached the `answered` state before starting recording. Check that the `call_control_id` is correct and matches an active call. Ensure your Telnyx account has recording enabled. If manually starting recording, wait at least 1–2 seconds after the call is answered before issuing the start command. |
| Phone Number Format Error | The endpoint returns `{"error": "Phone number must be in E.164 format"}`. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command and any hardcoded numbers in your code. |

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

- [Handle Inbound Calls with Webhooks](/tutorials/voice/python/inbound-call-webhook).
- [Transfer Calls Between Numbers](/tutorials/voice/python/call-transfer).
- [Build an Interactive Voice Response (IVR) Menu](/tutorials/voice/python/ivr-menu).
