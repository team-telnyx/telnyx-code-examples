# Webrtc Calling with Python and FastAPI

## What Does This Example Do?

Build a production-ready WebRTC calling application using Telnyx Voice API and FastAPI. This tutorial demonstrates how to establish peer-to-peer audio/video calls through the browser, manage call state with webhooks, and handle real-time call control commands. You'll create a backend that generates WebRTC credentials, manages call lifecycle events, and provides endpoints for initiating and controlling calls.

## Who Is This For?

- **Python developers** building voice features with FastAPI.
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
- A Telnyx phone number enabled for Call Control.
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- pip (Python package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Basic understanding of WebRTC concepts and async Python.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webrtc-browser-calling-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webrtc-browser-calling-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `call_manager.py` to handle call operations:

```python
import os
import telnyx
from config import TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID
from models import CallInitiateResponse

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=TELNYX_API_KEY)

# In-memory store for active calls (use Redis in production)
active_calls = {}


def initiate_webrtc_call(to_number: str, client_state: str = None) -> CallInitiateResponse:
    """
    Initiate a WebRTC call to a phone number.
    
    Args:
        to_number: Destination phone number in E.164 format.
        client_state: Optional custom state for tracking.
    
    Returns:
        CallInitiateResponse with call_control_id and call details.
    
    Raises:
        ValueError: If phone number format is invalid.
        telnyx.APIStatusError: If Telnyx API returns an error.
    """
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call via Telnyx Call Control API
    response = client.calls.dial(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        connection_id=TELNYX_CONNECTION_ID,
    )
    
    call_control_id = response.data.call_control_id
    
    # Store call metadata for webhook processing
    active_calls[call_control_id] = {
        "to_number": to_number,
        "from_number": TELNYX_PHONE_NUMBER,
        "client_state": client_state,
        "status": "initiated",
    }
    
    # Return JSON-serializable response
    return CallInitiateResponse(
        call_control_id=call_control_id,
        from_number=TELNYX_PHONE_NUMBER,
        to_number=to_number,
        status="initiated",
    )


def hangup_call(call_control_id: str) -> dict:
    """
    Terminate an active call.
    
    Args:
        call_control_id: Unique call identifier.
    
    Returns:
        Dictionary with hangup confirmation.
    """
    response = client.calls.actions.hangup(call_control_id)
    
    # Clean up call state
    if call_control_id in active_calls:
        del active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "action": "hangup",
        "status": "success",
    }


def transfer_call(call_control_id: str, transfer_to: str) -> dict:
    """
    Transfer an active call to another number.
    
    Args:
        call_control_id: Unique call identifier.
        transfer_to: Destination phone number in E.164 format.
    
    Returns:
        Dictionary with transfer confirmation.
    """
    if not transfer_to.startswith("+"):
        raise ValueError("Transfer destination must be in E.164 format")
    
    response = client.calls.actions.transfer(
        call_control_id,
        to=transfer_to,
    )
    
    return {
        "call_control_id": call_control_id,
        "action": "transfer",
        "transfer_to": transfer_to,
        "status": "success",
    }


def get_call_status(call_control_id: str) -> dict:
    """
    Retrieve the current status of a call.
    
    Args:
        call_control_id: Unique call identifier.
    
    Returns:
        Dictionary with call status and metadata.
    """
    response = client.calls.retrieve_status(call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "is_alive": response.data.is_alive,
        "state": response.data.state if hasattr(response.data, "state") else "unknown",
    }
```

Create `app.py` with FastAPI routes and webhook handlers:

```python
import telnyx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from call_manager import (
    initiate_webrtc_call,
    hangup_call,
    transfer_call,
    get_call_status,
    active_calls,
)
from models import CallInitiateRequest, CallActionRequest, WebhookEvent

app = FastAPI(title="Telnyx WebRTC Calling")


@app.post("/calls/initiate")
async def initiate_call(request: CallInitiateRequest):
    """
    Initiate a WebRTC call to a phone number.
    
    Request body:
    {
        "to_number": "+15559876543",
        "client_state": "optional-tracking-id"
    }
    """
    try:
        result = initiate_webrtc_call(
            to_number=request.to_number,
            client_state=request.client_state,
        )
        return result
    
    except telnyx.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid API key")
    except telnyx.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calls/hangup")
async def hangup_endpoint(request: CallActionRequest):
    """
    Terminate an active call.
    
    Request body:
    {
        "call_control_id": "v2:abc123..."
    }
    """
    try:
        result = hangup_call(request.call_control_id)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")


@app.post("/calls/transfer")
async def transfer_endpoint(request: CallActionRequest):
    """
    Transfer an active call to another number.
    
    Request body:
    {
        "call_control_id": "v2:abc123...",
        "transfer_to": "+15551111111"
    }
    """
    if not request.transfer_to:
        raise HTTPException(status_code=400, detail="transfer_to is required")
    
    try:
        result = transfer_call(request.call_control_id, request.transfer_to)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/calls/{call_control_id}/status")
async def status_endpoint(call_control_id: str):
    """
    Get the current status of a call.
    
    Path parameter:
    - call_control_id: Unique call identifier
    """
    try:
        result = get_call_status(call_control_id)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")


@app.post("/webhooks/call-events")
async def handle_call_webhook(request: Request):
    """
    Webhook endpoint to receive call state change events from Telnyx.
    
    Events:
    - call.initiated: Outbound call started
    - call.answered: Call connected
    - call.hangup: Call ended
    - call.dtmf.received: DTMF digit collected
    """
    body = await request.json()
    
    # Extract event type and call control ID
    event_type = body.get("data", {}).get("event_type")
    call_control_id = body.get("data", {}).get("call_control_id")
    
    if not event_type or not call_control_id:
        return JSONResponse({"status": "ignored"}, status_code=200)
    
    # Update call state based on event
    if event_type == "call.initiated":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.hangup":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "hangup"
            # Clean up after a short delay in production
            del active_calls[call_control_id]
    
    elif event_type == "call.dtmf.received":
        digit = body.get("data", {}).get("dtmf_digit")
        # Handle DTMF input (e.g., for IVR menus)
        pass
    
    # Always return 200 to acknowledge receipt
    return JSONResponse({"status": "received"}, status_code=200)


@app.get("/calls/active")
async def list_active_calls():
    """
    List all active calls (for debugging/monitoring).
    
    Returns:
    {
        "active_calls": [
            {
                "call_control_id": "v2:abc123...",
                "to_number": "+15559876543",
                "status": "answered"
            }
        ]
    }
    """
    calls_list = [
        {
            "call_control_id": cid,
            "to_number": data.get("to_number"),
            "status": data.get("status"),
        }
        for cid, data in active_calls.items()
    ]
    return {"active_calls": calls_list}


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"detail": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the FastAPI server after updating the `.env` file. |
| Connection ID Not Found | Telnyx API returns an error about invalid connection ID. | Confirm your `TELNYX_CONNECTION_ID` is set correctly in the `.env` file and matches a Call Control Application configured in the Telnyx Portal. The connection ID links your phone number to your Call Control application. |
| Webhook Events Not Received | Call state changes are not triggering webhook callbacks. | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible (use ngrok for local development). Configure the webhook URL in the Telnyx Portal under your Call Control Application settings to point to `https://your-url/webhooks/call-events`. Verify your firewall allows inbound HTTPS traffic on port 443. |
| Invalid Phone Number Format | Requests return `{"detail": "Phone number must be in E.164 format"}`. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test requests to use properly formatted numbers. |
| Call Control ID Not Found | Status or action endpoints return 404 or "call not found" errors. | Verify the `call_control_id` from the initiate call response is correct. Call IDs are returned immediately after initiating a call and are required for all subsequent actions. Ensure the call is still active (not already hung up). |
| Rate Limit Exceeded (429) | Requests return `{"detail": "Rate limit exceeded"}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your client code and reduce the frequency of requests. Check your usage in the Telnyx Portal to understand your rate limit tier. |

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
- [Build an IVR Menu System](/tutorials/voice/python/ivr-menu).
