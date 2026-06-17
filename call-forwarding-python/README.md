# Call Forwarding with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to intercept inbound calls via webhooks, route them to alternative numbers based on custom logic, and handle call control operations with proper error handling and state management.

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
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- A publicly accessible URL for webhook delivery (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, webhook handler, and call control logic:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for active calls (use Redis in production)
active_calls = {}


def forward_call(call_control_id: str, to_number: str) -> dict:
    """
    Transfer an active call to a new destination.
    
    Args:
        call_control_id: The unique identifier for the call to transfer.
        to_number: The destination number in E.164 format.
    
    Returns:
        Dictionary with transfer status.
    """
    if not to_number.startswith("+"):
        raise ValueError("Destination number must be in E.164 format (e.g., +15551234567)")
    
    # Use the transfer action to route the call
    response = client.calls.actions.transfer(
        call_control_id=call_control_id,
        to=to_number,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "call_control_id": response.data.call_control_id,
        "status": "transfer_initiated",
        "destination": to_number,
    }


def answer_call(call_control_id: str) -> dict:
    """
    Answer an inbound call.
    
    Args:
        call_control_id: The unique identifier for the call to answer.
    
    Returns:
        Dictionary with answer confirmation.
    """
    response = client.calls.actions.answer(call_control_id=call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "answered",
    }


def hangup_call(call_control_id: str) -> dict:
    """
    Terminate an active call.
    
    Args:
        call_control_id: The unique identifier for the call to hangup.
    
    Returns:
        Dictionary with hangup confirmation.
    """
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "hangup_initiated",
    }


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """
    Webhook endpoint to handle inbound call events.
    
    Telnyx sends call.initiated, call.answered, and call.hangup events here.
    This handler implements call forwarding logic.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload received"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    from_number = payload.get("data", {}).get("from")
    
    try:
        if event_type == "call.initiated":
            # Store call metadata for tracking
            active_calls[call_control_id] = {
                "from": from_number,
                "initiated_at": payload.get("data", {}).get("occurred_at"),
            }
            
            # Answer the call automatically
            answer_call(call_control_id)
            
            # Forward to the configured destination
            forward_to = os.getenv("FORWARD_TO_NUMBER")
            if not forward_to:
                raise ValueError("FORWARD_TO_NUMBER environment variable not set")
            
            forward_call(call_control_id, forward_to)
            
            return jsonify({"status": "call_forwarded"}), 200
        
        elif event_type == "call.answered":
            # Log call answer event
            if call_control_id in active_calls:
                active_calls[call_control_id]["answered_at"] = payload.get("data", {}).get("occurred_at")
            
            return jsonify({"status": "call_answered"}), 200
        
        elif event_type == "call.hangup":
            # Clean up call record
            if call_control_id in active_calls:
                del active_calls[call_control_id]
            
            return jsonify({"status": "call_ended"}), 200
        
        else:
            # Ignore other event types
            return jsonify({"status": "event_ignored"}), 200
    
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


@app.route("/calls/status/<call_control_id>", methods=["GET"])
def get_call_status(call_control_id: str):
    """
    Retrieve the status of an active call.
    
    Args:
        call_control_id: The unique identifier for the call.
    
    Returns:
        JSON with call status and metadata.
    """
    try:
        response = client.calls.retrieve_status(call_control_id)
        
        return jsonify({
            "call_control_id": response.data.call_control_id,
            "is_alive": response.data.is_alive,
            "state": response.data.state,
            "metadata": active_calls.get(call_control_id, {}),
        }), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/calls/hangup/<call_control_id>", methods=["POST"])
def hangup_call_endpoint(call_control_id: str):
    """
    Manually terminate an active call.
    
    Args:
        call_control_id: The unique identifier for the call to terminate.
    
    Returns:
        JSON with hangup confirmation.
    """
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The `/webhooks/call` endpoint is not being called when inbound calls arrive. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the webhook URL is exactly `https://your-ngrok-url/webhooks/call`. Check ngrok logs to confirm requests are being forwarded. Restart ngrok if the URL has expired (free tier URLs expire after 2 hours of inactivity). |
| Call transfer fails with API error | The `forward_call()` function returns a 4xx or 5xx error from the Telnyx API. | Verify that `FORWARD_TO_NUMBER` is in valid E.164 format (e.g., `+15551234567`). Ensure the destination number is reachable and not blocked. Check that your API key has permissions for call control operations. Review the error message in the response for specific details about why the transfer failed. |
| Connection ID not recognized | The application raises an error about an invalid or missing Connection ID during call operations. | Confirm that `TELNYX_CONNECTION_ID` in your `.env` file matches the Call Control Application ID shown in the Telnyx Portal. The Connection ID links your phone number to your application—without it, the API cannot route calls to your webhook. Verify the ID has no extra spaces or special characters. |
| Calls not being answered automatically | Inbound calls ring but are not automatically answered by the application. | Ensure the `call.initiated` event is being received by checking Flask logs. Verify that `answer_call()` is being invoked without exceptions. Check that your Call Control Application is properly linked to your Telnyx phone number in the Portal. Test with a simple curl request to `/health` to confirm the Flask server is running. |
| Rate limit errors (429) | The application returns `{"error": "Rate limit exceeded"}` when handling multiple calls. | Implement exponential backoff retry logic in production. Use a message queue (e.g., Celery with Redis) to process call events asynchronously instead of synchronously in the webhook handler. Contact Telnyx support to request a higher rate limit if you expect high call volume. |

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

- [Make an Outbound Call with Python](/tutorials/voice/python/outbound-call).
- [Handle Inbound Calls with Webhooks](/tutorials/voice/python/inbound-call-webhook).
- [Record Calls with Python](/tutorials/voice/python/call-recording).
