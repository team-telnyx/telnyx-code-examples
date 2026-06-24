# Hold Music with Python and Flask

## What Does This Example Do?

Build a Flask application that plays hold music during phone calls using the Telnyx Voice API. This tutorial demonstrates call control operations, audio playback management, and webhook handling to create a professional hold music experience for callers.

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
- A Call Control Application configured in the Telnyx Portal.
- pip (Python package manager).
- ngrok or similar tool for webhook testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and implement the hold music functionality with proper call control:

```python
import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and their hold status
active_calls = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    response = client.calls.dial(
        from_=os.getenv("TELNYX_PHONE_NUMBER"),
        to=to_number,
        connection_id=os.getenv("TELNYX_CONNECTION_ID"),
    )
    
    call_control_id = response.data.call_control_id
    active_calls[call_control_id] = {"on_hold": False, "to_number": to_number}
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
    }


def start_hold_music(call_control_id: str) -> dict:
    """Start playing hold music for the specified call."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    # Use a royalty-free hold music URL or upload your own audio file
    hold_music_url = "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav"
    
    response = client.calls.actions.playback_start(
        call_control_id,
        audio_url=hold_music_url,
        loop=True,  # Loop the audio continuously
        overlay=False,
    )
    
    active_calls[call_control_id]["on_hold"] = True
    
    return {
        "call_control_id": call_control_id,
        "status": "hold_music_started",
        "on_hold": True,
    }


def stop_hold_music(call_control_id: str) -> dict:
    """Stop hold music and resume normal call flow."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    # Stop the current playback
    client.calls.actions.playback_stop(call_control_id)
    
    active_calls[call_control_id]["on_hold"] = False
    
    return {
        "call_control_id": call_control_id,
        "status": "hold_music_stopped",
        "on_hold": False,
    }


def get_call_status(call_control_id: str) -> dict:
    """Get current call status including hold state."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    response = client.calls.retrieve_status(call_control_id)
    call_data = active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "is_alive": response.data.is_alive,
        "on_hold": call_data["on_hold"],
        "to_number": call_data["to_number"],
    }
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-python/app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Hold music not playing | The `/hold` endpoint returns success but no audio plays during the call. | Verify the audio URL is accessible and in a supported format (WAV, MP3). Test the URL directly in a browser. Ensure the call is answered before starting playback. Check that the `loop=True` parameter is set for continuous playback. |
| Call Control ID not found | Endpoints return 404 error with "Call not found" message. | Ensure you're using the correct `call_control_id` returned from the `/calls/initiate` endpoint. The ID is only valid for active calls. If the call ended, the ID is removed from `active_calls`. Check that the call was successfully initiated before attempting hold operations. |
| Webhook events not received | The Flask server doesn't receive webhook events from Telnyx. | Confirm your webhook URL is publicly accessible via ngrok or similar tool. Update your Call Control Application in the Telnyx Portal with the correct webhook URL (e.g., `https://abc123.ngrok.io/webhooks/voice`). Verify the webhook URL environment variable matches your actual endpoint. Check ngrok logs for incoming requests. |

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

- [Record Phone Calls with Python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/call-transfer).
- [Build an Interactive Voice Response Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/ivr-menu).
