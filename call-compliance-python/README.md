# Call Compliance with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that implements call compliance features using the Telnyx Voice API. This tutorial demonstrates call recording, consent collection via DTMF, and compliance data storage to meet regulatory requirements for business communications.

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
- A Telnyx phone number enabled for outbound calling.
- A Call Control Application configured in the Telnyx Portal.
- A publicly accessible webhook URL (use ngrok for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-compliance-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-compliance-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Implement helper functions for call management and compliance tracking:

```python
import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory storage for compliance records
COMPLIANCE_FILE = "compliance_records.json"


def load_compliance_records():
    """Load compliance records from JSON file."""
    try:
        with open(COMPLIANCE_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_compliance_records(records):
    """Save compliance records to JSON file."""
    with open(COMPLIANCE_FILE, 'w') as f:
        json.dump(records, f, indent=2)


def initiate_compliance_call(to_number: str) -> dict:
    """Initiate an outbound call with compliance features enabled."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("Missing required environment variables")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
        # Enable call recording for compliance
        record="record-from-answer",
        record_format="mp3",
        record_channels="dual",
    )
    
    # Initialize compliance record
    call_control_id = response.data.call_control_id
    records = load_compliance_records()
    records[call_control_id] = {
        "call_control_id": call_control_id,
        "to_number": to_number,
        "from_number": from_number,
        "initiated_at": datetime.utcnow().isoformat(),
        "consent_given": False,
        "recording_started": False,
        "compliance_status": "pending",
    }
    save_compliance_records(records)
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
        "compliance_tracking": True,
    }


def handle_call_answered(call_control_id: str):
    """Handle call answered event - play consent message."""
    # Play consent message and collect DTMF response
    client.calls.actions.speak(
        call_control_id=call_control_id,
        payload="This call may be recorded for quality and compliance purposes. Press 1 to consent to recording, or press 2 to decline.",
        voice="female",
        language="en-US",
    )
    
    # Gather DTMF input for consent
    client.calls.actions.gather_using_speak(
        call_control_id=call_control_id,
        payload="Press 1 to consent or 2 to decline recording.",
        voice="female",
        language="en-US",
        valid_digits="12",
        max=1,
        timeout_millis=10000,
    )


def handle_dtmf_received(call_control_id: str, digit: str):
    """Process DTMF consent response."""
    records = load_compliance_records()
    
    if call_control_id not in records:
        return
    
    record = records[call_control_id]
    
    if digit == "1":
        # Consent given - start recording
        record["consent_given"] = True
        record["compliance_status"] = "compliant"
        
        client.calls.actions.start_recording(
            call_control_id=call_control_id,
            format="mp3",
            channels="dual",
        )
        
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload="Thank you for your consent. Recording has started. You will now be connected.",
            voice="female",
            language="en-US",
        )
        
    elif digit == "2":
        # Consent declined - proceed without recording
        record["consent_given"] = False
        record["compliance_status"] = "no_consent"
        
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload="Recording declined. Proceeding with unrecorded call.",
            voice="female",
            language="en-US",
        )
    
    record["consent_processed_at"] = datetime.utcnow().isoformat()
    save_compliance_records(records)


def handle_call_hangup(call_control_id: str):
    """Handle call hangup - finalize compliance record."""
    records = load_compliance_records()
    
    if call_control_id in records:
        records[call_control_id]["ended_at"] = datetime.utcnow().isoformat()
        records[call_control_id]["status"] = "completed"
        save_compliance_records(records)
```

## Complete Code

See [`app.py`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-python/app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook Not Receiving Events | The Flask app starts successfully but webhook events are not being processed, resulting in calls that don't play the consent message. | Verify your webhook URL is publicly accessible by testing it with curl. Ensure the URL in your Call Control Application settings matches your ngrok URL exactly, including the `/webhooks/voice` path. Check that ngrok is running and hasn't changed the URL. Restart ngrok if the URL has changed and update your Telnyx application settings. |
| DTMF Not Being Collected | Calls connect but pressing digits doesn't trigger the consent flow, and the compliance status remains "pending". | Confirm your Call Control Application has DTMF detection enabled in the Telnyx Portal. Verify the `gather_using_speak` action is being called after the call is answered. Check webhook logs for `call.dtmf.received` events. Ensure the phone being used can send DTMF tones (some VoIP clients may have issues). |
| Recording Not Starting | Consent is given (digit "1" pressed) but no recording file is created, and the compliance record shows `recording_started: false`. | Verify your Telnyx account has recording permissions enabled. Check that the `start_recording` action is being called after consent is given. Ensure your Call Control Application has recording capabilities configured. Monitor for `call.recording.saved` webhook events to confirm recording completion. The recording may take time to process after the call ends. |

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
- [Implement Call Recording](/tutorials/voice/python/call-recording).
- [Build an IVR Menu System](/tutorials/voice/python/ivr-menu).
