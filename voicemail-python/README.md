# Build a Voicemail System with Python and Flask

## What Does This Example Do?

Create a production-ready voicemail system using Telnyx Call Control API and Flask. This tutorial demonstrates how to handle incoming calls, play greeting messages, record voicemails, and manage call flow with webhook events. You'll build a complete system that answers calls, plays a custom greeting, and saves voicemail recordings.

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

- Python 3.8 or higher
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com)
- A Telnyx phone number configured with a Call Control Application
- Your Call Control Application ID (connection_id)
- A publicly accessible URL for webhooks (use ngrok for local development)
- pip (Python package manager)

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and implement the voicemail system with proper call handling:

```python
import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and their states
call_sessions = {}


def answer_call(call_control_id: str) -> dict:
    """Answer incoming call and return response data."""
    response = client.calls.actions.answer(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "answered"
    }


def play_greeting(call_control_id: str) -> dict:
    """Play voicemail greeting message."""
    greeting_text = (
        "Hello! You've reached our voicemail system. "
        "Please leave your message after the beep, and we'll get back to you soon."
    )
    
    response = client.calls.actions.speak(
        call_control_id,
        payload=greeting_text,
        voice="female",
        language="en-US"
    )
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "playing_greeting"
    }


def start_recording(call_control_id: str) -> dict:
    """Start recording the voicemail message."""
    # Generate unique filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"voicemail_{timestamp}_{call_control_id[:8]}"
    
    response = client.calls.actions.start_recording(
        call_control_id,
        format="mp3",
        channels="single",
        play_beep=True,
        # Recording will be available via webhook when complete
    )
    
    # Store recording info for this call
    call_sessions[call_control_id]["recording_filename"] = filename
    call_sessions[call_control_id]["recording_started"] = datetime.now().isoformat()
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "recording_started",
        "filename": filename
    }


def hangup_call(call_control_id: str) -> dict:
    """Hangup the call gracefully."""
    response = client.calls.actions.hangup(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "hangup"
    }
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-python/app.py) for the full implementation.

## Troubleshooting

### Issue 1: Webhooks Not Received

**Problem:** Your Flask app doesn't receive webhook events when calls are made to your Telnyx number.

**Solution:** Verify your Call Control Application in the Telnyx Portal is configured with the correct webhook URL (your ngrok URL + `/webhooks/voice`). Ensure ngrok is running and the tunnel is active. Check that your Telnyx phone number is associated with the Call Control Application, not a different application type like TeXML or SIP.

### Issue 2: Call Answers But No Greeting Plays

**Problem:** Incoming calls are answered successfully but the greeting message doesn't play, or you hear silence.

**Solution:** Check the webhook logs for `call.speak.ended` events. The text-to-speech might be failing due to invalid characters or language settings. Verify the `voice` and `language` parameters in the `play_greeting()` function match supported Telnyx TTS options. Ensure your webhook endpoint returns proper HTTP 200 responses for all events.

### Issue 3: Recording Not Starting After Greeting

**Problem:** The greeting plays successfully but recording never begins, or you don't receive the beep tone.

**Solution:** Confirm that the `call.speak.ended` event is triggering the recording start. Check that the call session state is properly tracked and matches `"playing_greeting"` when the speak event completes. Verify your Telnyx account has recording permissions enabled. The `play_beep=True` parameter should provide an audible beep before recording starts.

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/inbound-call-webhook)
- [Implement Call Recording](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/call-recording)
- [Build an Interactive Voice Response Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/python/ivr-menu)
