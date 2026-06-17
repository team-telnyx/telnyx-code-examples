# Inbound Call Webhook with Python and Flask

## What Does This Example Do?

Build a production-ready Flask webhook endpoint that receives and processes inbound calls from the Telnyx Voice API. This tutorial demonstrates how to handle call control events, answer incoming calls, and respond with text-to-speech using the Telnyx Python SDK and webhook event handling.

## Who Is This For?

- **Python developers** building voice features with Flask.
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
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal with your webhook URL.
- A publicly accessible URL (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to handle call control actions:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def answer_call(call_control_id: str) -> dict:
    """Answer an inbound call."""
    response = client.calls.actions.answer(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "answered",
    }


def speak_to_call(call_control_id: str, message: str) -> dict:
    """Play text-to-speech message to the call."""
    response = client.calls.actions.speak(
        call_control_id,
        payload=message,
        voice="female",
        language_code="en-US",
    )
    return {
        "call_control_id": response.data.call_control_id,
        "message": message,
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate the call."""
    response = client.calls.actions.hangup(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "hangup_initiated",
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The Flask endpoint is running but Telnyx is not sending webhook payloads. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the webhook URL is exactly `https://your-ngrok-url.ngrok.io/webhooks/call` with no trailing slashes. Check that ngrok is still running and the tunnel is active. Restart ngrok if the URL changes. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` when processing webhook events. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating the `.env` file. |
| Call not being answered | Inbound calls ring but are not answered by the webhook. | Confirm that the `call.initiated` event is being received by checking Flask logs. Verify that `answer_call()` is being invoked without exceptions. Check that your Call Control Application is properly linked to your Telnyx phone number in the Portal. Ensure the phone number is in E.164 format in your configuration. |
| Missing call_control_id in payload | The webhook receives events but `call_control_id` is None or missing. | Verify that the webhook payload structure matches Telnyx's event format. Check the Telnyx documentation for the exact payload structure of `call.initiated` events. Log the entire payload to debug: add `print(json.dumps(payload, indent=2))` in the webhook handler. |
| TTS message not playing | The call is answered but no audio is heard. | Verify that the `speak_to_call()` function is being called after `answer_call()`. Check that the message text is not empty. Ensure the voice and language_code parameters are valid (e.g., `voice="female"`, `language_code="en-US"`). Review Flask logs for any API errors returned by the Telnyx SDK. |

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
- [Record Inbound Calls with Python](/tutorials/voice/python/call-recording).
- [Build an IVR Menu with Python](/tutorials/voice/python/ivr-menu).
