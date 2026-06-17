# Text To Speech with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that initiates outbound calls and plays text-to-speech (TTS) messages using the Telnyx Voice API. This tutorial demonstrates the Call Control command-event model, proper handling of webhook events, and secure credential management for telecom applications.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- pip (Python package manager).
- A publicly accessible URL for receiving webhooks (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to manage call initiation and TTS playback:

```python
import os
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
    
    # Store call metadata for webhook processing
    active_calls[call_control_id] = {
        "to": to_number,
        "from": from_number,
        "status": "initiated",
    }
    
    return {
        "call_control_id": call_control_id,
        "to": to_number,
        "from": from_number,
        "status": "initiated",
    }


def speak_text(call_control_id: str, text: str, language: str = "en-US") -> dict:
    """Play text-to-speech message on an active call."""
    # Use the Call Control speak action to play TTS
    response = client.calls.actions.speak(
        call_control_id=call_control_id,
        payload=text,
        language=language,
    )
    
    return {
        "call_control_id": call_control_id,
        "message": "TTS playback initiated",
        "text": text,
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    # Clean up call tracking
    if call_control_id in active_calls:
        del active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup_initiated",
    }
```

Add Flask routes to handle call initiation, TTS playback, and webhook events:

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
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/<call_control_id>/speak", methods=["POST"])
def speak_endpoint(call_control_id):
    """HTTP endpoint to play TTS on an active call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    text = data.get("text")
    language = data.get("language", "en-US")
    
    if not text:
        return jsonify({"error": "Missing required field: 'text'"}), 400
    
    try:
        result = speak_text(call_control_id, text, language)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/calls/<call_control_id>/hangup", methods=["POST"])
def hangup_endpoint(call_control_id):
    """HTTP endpoint to terminate a call."""
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """Webhook endpoint to receive Call Control events."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log event for debugging
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Handle different call events
    if event_type == "call.initiated":
        # Call has been initiated — ready for TTS
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        # Call has been answered — can now play TTS
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.speak.ended":
        # TTS playback has finished
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "speak_ended"
    
    elif event_type == "call.hangup":
        # Call has ended — clean up
        if call_control_id in active_calls:
            del active_calls[call_control_id]
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/status", methods=["GET"])
def get_calls_status():
    """HTTP endpoint to retrieve status of all active calls."""
    return jsonify({"active_calls": active_calls}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Call Not Initiated — Invalid Connection ID | The API returns a 422 error or call fails to initiate with "invalid connection_id". | Confirm your `TELNYX_CONNECTION_ID` in the `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application and must be configured correctly. Verify the application is active and has a valid webhook URL configured. |
| Webhook Events Not Received | The `/webhooks/call` endpoint is not receiving events even though calls are initiated. | Ensure your webhook URL in the Telnyx Portal matches your publicly accessible domain (use ngrok for local testing: `https://your-ngrok-url.ngrok.io/webhooks/call`). Verify the Flask server is running and accessible from the internet. Check your firewall and network settings. Enable debug logging in Flask to see incoming requests. |
| TTS Playback Not Starting | The `/speak` endpoint returns 200 but no audio is played on the call. | Ensure the call has reached the `answered` state before attempting to play TTS. Check the webhook events to confirm `call.answered` was received. Verify the `text` parameter is not empty and the `language` code is valid (e.g., `en-US`, `es-ES`). The call must be active and connected for TTS to play. |
| Phone Number Format Error | The endpoint returns `{"error": "Phone number must be in E.164 format"}`. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands to use properly formatted numbers. |

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

- [Handle Inbound Call Webhooks](/tutorials/voice/python/inbound-call-webhook).
- [Record and Store Call Audio](/tutorials/voice/python/call-recording).
- [Transfer Calls Between Numbers](/tutorials/voice/python/call-transfer).
