# Whisper Prompt with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that initiates outbound calls and uses OpenAI's Whisper API to transcribe caller speech in real-time, then responds with AI-generated prompts. This tutorial demonstrates the Telnyx Voice API's call control capabilities combined with speech-to-text processing, webhook event handling, and dynamic call management using the Python SDK.

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
- A Telnyx Call Control Application configured with a webhook URL.
- An OpenAI API key for Whisper transcription.
- pip (Python package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx and OpenAI clients. Define helper functions to manage call state, transcribe audio, and generate responses:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from openai import OpenAI

load_dotenv()

app = Flask(__name__)

# Initialize clients with the new SDK pattern
telnyx_client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# In-memory store for call state (use Redis in production)
call_state = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using the Call Control API
    response = telnyx_client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    # Store call state for webhook processing
    call_state[call_control_id] = {
        "to": to_number,
        "from": from_number,
        "status": "initiated",
        "transcript": "",
    }
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
        "to": to_number,
    }


def transcribe_audio(audio_url: str) -> str:
    """Download audio from URL and transcribe using OpenAI Whisper."""
    try:
        # Download audio file from Telnyx
        response = request.get(audio_url, timeout=10)
        response.raise_for_status()
        
        # Transcribe using Whisper API
        transcript_response = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=("audio.wav", response.content, "audio/wav"),
        )
        
        return transcript_response.text
    except Exception as e:
        return f"Transcription failed: {str(e)}"


def generate_prompt_response(transcript: str) -> str:
    """Generate an AI response based on transcribed text."""
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant on a phone call. Respond concisely in 1-2 sentences.",
                },
                {"role": "user", "content": transcript},
            ],
            max_tokens=100,
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Response generation failed: {str(e)}"


def speak_response(call_control_id: str, text: str) -> dict:
    """Use Telnyx Speak action to play text-to-speech response."""
    try:
        response = telnyx_client.calls.actions.speak(
            call_control_id=call_control_id,
            payload=text,
            language="en-US",
            voice="female",
        )
        return {"status": "speaking", "call_control_id": call_control_id}
    except Exception as e:
        return {"error": str(e)}
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating credentials. |
| Connection ID Not Found | The call initiation fails with an error about invalid connection ID. | Confirm your `TELNYX_CONNECTION_ID` is set in the `.env` file and matches a Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control API. Verify the application has a webhook URL configured. |
| Webhook Not Receiving Events | Call events are not triggering the webhook handler. | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible and matches the webhook URL configured in your Call Control Application settings. Use ngrok (`ngrok http 5000`) to expose your local Flask server during development. Verify the webhook URL is reachable by testing with curl from an external machine. |
| Whisper Transcription Fails | The transcription endpoint returns an error or empty transcript. | Verify your `OPENAI_API_KEY` is valid and has sufficient quota. Check that the audio file URL from the webhook is accessible and contains valid WAV audio. Ensure the OpenAI client is initialized correctly with the API key. |
| Phone Number Format Error | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

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
- [Record and Retrieve Call Audio](/tutorials/voice/python/call-recording).
- [Transfer Calls Between Numbers](/tutorials/voice/python/call-transfer).
