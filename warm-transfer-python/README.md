# Warm Transfer with Python and Flask

## What Does This Example Do?

Build a Flask application that performs warm transfers using the Telnyx Call Control API. A warm transfer allows you to connect the original caller with a third party while staying on the line to facilitate the introduction, then optionally leaving the call. This tutorial demonstrates call initiation, transfer mechanics, and webhook handling for production-ready voice applications.

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
- A Telnyx phone number enabled for voice calls.
- A Call Control Application configured with your webhook URL.
- ngrok or similar tool for webhook testing (optional for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and implement the warm transfer logic. Start with the client initialization and helper functions:

```python
import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and transfer states
active_calls = {}
transfer_sessions = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("Missing required environment variables")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format")
    
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    return {
        "call_control_id": response.data.call_control_id,
        "from": from_number,
        "to": to_number,
    }


def perform_warm_transfer(call_control_id: str, transfer_to: str) -> dict:
    """Initiate warm transfer by calling the transfer target first."""
    # Store the original call info
    if call_control_id not in active_calls:
        raise ValueError("Original call not found")
    
    # Initiate call to transfer target
    transfer_call = initiate_call(transfer_to)
    transfer_call_id = transfer_call["call_control_id"]
    
    # Store transfer session info
    transfer_sessions[transfer_call_id] = {
        "original_call_id": call_control_id,
        "transfer_to": transfer_to,
        "status": "connecting"
    }
    
    return {
        "transfer_call_id": transfer_call_id,
        "original_call_id": call_control_id,
        "status": "connecting_transfer_target"
    }


def complete_transfer(original_call_id: str, transfer_call_id: str) -> dict:
    """Complete the warm transfer by bridging calls."""
    response = client.calls.actions.transfer(
        call_control_id=original_call_id,
        to=transfer_call_id,
    )
    
    # Clean up transfer session
    if transfer_call_id in transfer_sessions:
        transfer_sessions[transfer_call_id]["status"] = "completed"
    
    return {
        "original_call_id": original_call_id,
        "transfer_call_id": transfer_call_id,
        "status": "transfer_completed"
    }
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-python/app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Connection ID Error | The endpoint returns an error about invalid connection_id or the call fails to initiate. | Verify your `TELNYX_CONNECTION_ID` matches your Call Control Application ID in the Telnyx Portal. This is different from your API key and phone number. Navigate to Voice > Call Control Apps and copy the correct Connection ID. Ensure your webhook URL is configured in the same application. |
| Transfer Target Not Answering | The warm transfer initiates but the transfer target never answers, leaving the original caller on hold. | Implement timeout logic in your webhook handler to detect unanswered transfer attempts. Add a fallback mechanism to return to the original call or route to voicemail after 30-60 seconds. Consider using `client.calls.actions.hangup()` to clean up abandoned transfer attempts. |
| Webhook Not Receiving Events | Your Flask application doesn't receive call.answered or call.hangup events during testing. | Ensure your webhook URL is publicly accessible (use ngrok for local testing: `ngrok http 5000`). Verify the webhook URL in your Call Control Application matches your endpoint exactly, including the `/webhooks/voice` path. Check that your firewall allows incoming HTTP requests on the specified port. |

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
- [Record Voice Calls](/tutorials/voice/python/call-recording).
- [Build an Interactive Voice Response Menu](/tutorials/voice/python/ivr-menu).
