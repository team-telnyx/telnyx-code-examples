# Conference Call with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that creates and manages conference calls using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, add participants to a conference, handle real-time call control events via webhooks, and manage call state across multiple participants. You'll learn the command-event model that powers Telnyx Call Control, secure credential management, and proper error handling for telecom APIs.

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
- A publicly accessible URL for webhook delivery (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, client initialization, and conference management logic:

```python
import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for conference state (use a database in production)
conferences = {}


def create_conference(conference_name: str, participants: list) -> dict:
    """
    Create a conference and initiate calls to all participants.
    
    Args:
        conference_name: Unique identifier for the conference.
        participants: List of phone numbers in E.164 format.
    
    Returns:
        Dictionary with conference_id and call_control_ids for each participant.
    """
    if not conference_name or not participants:
        raise ValueError("Conference name and participants list are required")
    
    # Validate phone numbers
    for phone in participants:
        if not phone.startswith("+"):
            raise ValueError(f"Phone number {phone} must be in E.164 format")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set")
    
    # Initialize conference state
    conferences[conference_name] = {
        "created_at": datetime.utcnow().isoformat(),
        "participants": {},
        "status": "active",
    }
    
    call_control_ids = []
    
    # Initiate calls to each participant
    for participant_number in participants:
        try:
            response = client.calls.dial(
                from_=from_number,
                to=participant_number,
                connection_id=connection_id,
            )
            
            call_control_id = response.data.call_control_id
            call_control_ids.append(call_control_id)
            
            # Store participant state
            conferences[conference_name]["participants"][call_control_id] = {
                "phone_number": participant_number,
                "status": "initiated",
                "joined_at": None,
            }
            
        except telnyx.APIStatusError as e:
            # Log error but continue with other participants
            print(f"Failed to dial {participant_number}: {e}")
    
    return {
        "conference_id": conference_name,
        "call_control_ids": call_control_ids,
        "participant_count": len(call_control_ids),
    }


def add_participant_to_conference(conference_name: str, phone_number: str) -> dict:
    """Add a new participant to an existing conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    if not phone_number.startswith("+"):
        raise ValueError(f"Phone number {phone_number} must be in E.164 format")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    response = client.calls.dial(
        from_=from_number,
        to=phone_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    conferences[conference_name]["participants"][call_control_id] = {
        "phone_number": phone_number,
        "status": "initiated",
        "joined_at": None,
    }
    
    return {
        "call_control_id": call_control_id,
        "phone_number": phone_number,
    }


def end_conference(conference_name: str) -> dict:
    """Hang up all participants in a conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    conference = conferences[conference_name]
    hangup_count = 0
    
    for call_control_id in conference["participants"].keys():
        try:
            client.calls.actions.hangup(call_control_id)
            hangup_count += 1
        except telnyx.APIStatusError as e:
            print(f"Failed to hangup {call_control_id}: {e}")
    
    conference["status"] = "ended"
    conference["ended_at"] = datetime.utcnow().isoformat()
    
    return {
        "conference_id": conference_name,
        "hangup_count": hangup_count,
    }


def get_conference_status(conference_name: str) -> dict:
    """Retrieve the current state of a conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    conference = conferences[conference_name]
    
    return {
        "conference_id": conference_name,
        "status": conference["status"],
        "created_at": conference["created_at"],
        "participant_count": len(conference["participants"]),
        "participants": [
            {
                "call_control_id": cid,
                "phone_number": data["phone_number"],
                "status": data["status"],
                "joined_at": data["joined_at"],
            }
            for cid, data in conference["participants"].items()
        ],
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Confirm that `TELNYX_CONNECTION_ID` in your `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to your Call Control application and must be configured before initiating calls. |
| Webhook Events Not Received | Conference status shows "initiated" but never transitions to "answered" even after participants pick up. | Ensure your ngrok URL is correctly configured in the Telnyx Portal's Call Control Application webhook settings. The webhook URL should be `https://your-ngrok-url.ngrok.io/webhooks/call-events`. Verify that ngrok is running and your Flask server is accessible. Check Flask logs for incoming POST requests to `/webhooks/call-events`. |
| Phone Number Format Error | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands and any hardcoded numbers in your code. |
| Conference Not Found | Attempting to add a participant or check status returns `{"error": "Conference ... not found"}` with HTTP 404. | Verify that the conference was successfully created by checking the response from the `/conference/create` endpoint. Use the exact `conference_name` value from the creation response when making subsequent requests. Conference names are case-sensitive. |
| Rate Limit Exceeded | The API returns `{"error": "Rate limit exceeded"}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your application when retrying failed requests. Space out conference creation requests and avoid rapid successive calls to the same endpoint. Consider using a task queue (Celery) for high-volume conference scheduling. |

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
- [Record and Retrieve Call Recordings](/tutorials/voice/python/call-recording).
- [Transfer Calls Between Participants](/tutorials/voice/python/call-transfer).
