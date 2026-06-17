# Ivr Menu with Python and Flask

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using the Telnyx Voice API and Flask. This tutorial demonstrates how to handle inbound calls, play voice prompts, collect DTMF (dual-tone multi-frequency) input from callers, and route calls based on menu selections. You'll learn the command-event model that powers Telnyx Call Control, webhook handling for asynchronous call events, and state management for multi-step call flows.

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
- A Call Control Application configured in the Telnyx Portal (linked to your phone number).
- A publicly accessible URL for webhook callbacks (ngrok, Heroku, or similar for local development).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create helper functions to manage call control actions and state transitions:

```python
def play_prompt(call_control_id: str, prompt_text: str) -> None:
    """Play a text-to-speech prompt to the caller."""
    try:
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload=prompt_text,
            language="en-US",
            voice="female",
        )
    except telnyx.APIStatusError as e:
        print(f"Error playing prompt: {e}")


def gather_dtmf(call_control_id: str, max_digits: int = 1) -> None:
    """Gather DTMF input from the caller."""
    try:
        client.calls.actions.gather_using_speak(
            call_control_id=call_control_id,
            payload="",  # Empty payload — we already played the prompt
            max_digits=max_digits,
            timeout_millis=5000,
            language="en-US",
            voice="female",
        )
    except telnyx.APIStatusError as e:
        print(f"Error gathering DTMF: {e}")


def transfer_call(call_control_id: str, to_number: str) -> None:
    """Transfer the call to a destination number."""
    try:
        client.calls.actions.transfer(
            call_control_id=call_control_id,
            to=to_number,
        )
    except telnyx.APIStatusError as e:
        print(f"Error transferring call: {e}")


def hangup_call(call_control_id: str) -> None:
    """Hang up the call."""
    try:
        client.calls.actions.hangup(call_control_id=call_control_id)
    except telnyx.APIStatusError as e:
        print(f"Error hanging up call: {e}")


def initialize_call_state(call_control_id: str, from_number: str) -> None:
    """Initialize state for a new inbound call."""
    call_state[call_control_id] = {
        "from": from_number,
        "current_menu": "main",
        "dtmf_input": "",
    }
```

Now create the webhook endpoints to handle call events:

```python
@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """Handle inbound call events from Telnyx."""
    try:
        payload = request.get_json()
        
        if not payload:
            return jsonify({"error": "Empty payload"}), 400
        
        # Extract event data
        event_type = payload.get("data", {}).get("event_type")
        call_control_id = payload.get("data", {}).get("call_control_id")
        from_number = payload.get("data", {}).get("from", {}).get("phone_number")
        
        if not event_type or not call_control_id:
            return jsonify({"error": "Missing required fields"}), 400
        
        # Handle call.initiated — inbound call received
        if event_type == "call.initiated":
            initialize_call_state(call_control_id, from_number)
            # Answer the call
            client.calls.actions.answer(call_control_id=call_control_id)
            # Play the main menu prompt
            menu_prompt = MENU_CONFIG["main"]["prompt"]
            play_prompt(call_control_id, menu_prompt)
            # Gather DTMF input
            gather_dtmf(call_control_id)
            return jsonify({"status": "call answered"}), 200
        
        # Handle call.dtmf.received — caller pressed a digit
        elif event_type == "call.dtmf.received":
            digit = payload.get("data", {}).get("dtmf_digit")
            
            if call_control_id not in call_state:
                return jsonify({"error": "Call state not found"}), 404
            
            current_menu = call_state[call_control_id]["current_menu"]
            menu_options = MENU_CONFIG[current_menu]["options"]
            
            # Route based on DTMF input
            if digit in menu_options:
                next_menu = menu_options[digit]
                call_state[call_control_id]["current_menu"] = next_menu
                
                # Handle transfer destinations
                if next_menu == "transfer_sales":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876543")  # Sales number
                elif next_menu == "tech_support":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876544")  # Tech support number
                elif next_menu == "billing":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876545")  # Billing number
                else:
                    # Play next menu prompt
                    menu_prompt = MENU_CONFIG[next_menu]["prompt"]
                    play_prompt(call_control_id, menu_prompt)
                    gather_dtmf(call_control_id)
            else:
                # Invalid input — replay current menu
                menu_prompt = MENU_CONFIG[current_menu]["prompt"]
                play_prompt(call_control_id, menu_prompt)
                gather_dtmf(call_control_id)
            
            return jsonify({"status": "dtmf processed"}), 200
        
        # Handle call.hangup — call ended
        elif event_type == "call.hangup":
            if call_control_id in call_state:
                del call_state[call_control_id]
            return jsonify({"status": "call ended"}), 200
        
        # Handle call.speak.ended — TTS playback finished
        elif event_type == "call.speak.ended":
            return jsonify({"status": "speak ended"}), 200
        
        else:
            return jsonify({"status": f"event {event_type} received"}), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/webhooks/call/status", methods=["GET"])
def get_call_status():
    """Retrieve the current state of all active calls."""
    try:
        # Return call state as JSON-serializable dict
        return jsonify({"active_calls": call_state}), 200
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The Flask server is running but Telnyx is not sending call events to your webhook URL. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under Call Control Application settings. Ensure the webhook URL is `https://your-ngrok-url/webhooks/call` (HTTPS, not HTTP). Check that your firewall or network allows inbound HTTPS traffic. Test the webhook endpoint manually: `curl -X POST https://your-ngrok-url/webhooks/call -H "Content-Type: application/json" -d '{}'`. |
| Call not answered or prompt not playing | The call is received but the IVR does not answer or play audio. | Verify that `client.calls.actions.answer()` is called in the `call.initiated` handler. Check that the `call_control_id` is correctly extracted from the webhook payload. Ensure your Telnyx account has sufficient credits and the phone number is active. Review Flask logs for exceptions in the `play_prompt()` function. |
| DTMF input not detected | Caller presses digits but the IVR does not respond to the input. | Confirm that `gather_dtmf()` is called after playing the prompt. Verify that the `call.dtmf.received` event is enabled in your Call Control Application settings. Check that the `dtmf_digit` field is present in the webhook payload. Increase the `timeout_millis` value in `gather_dtmf()` if callers need more time to respond. |
| Call transfer fails | The transfer action is called but the call is not transferred to the destination number. | Verify that the destination phone number is in E.164 format (e.g., `+15559876543`). Ensure the destination number is a valid, active phone number. Check that your Telnyx account has permission to transfer calls. Review the Telnyx API response for error details in Flask logs. |
| State not persisting across events | Call state is lost between webhook events, causing the IVR to reset. | In production, replace the in-memory `call_state` dictionary with a persistent store (Redis, PostgreSQL, etc.). Ensure `initialize_call_state()` is called exactly once per call in the `call.initiated` handler. Add logging to track state transitions: `print(f"State: {call_state[call_control_id]}")`. |

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
- [Record and Store Call Audio](/tutorials/voice/python/call-recording).
- [Transfer Calls Between Numbers](/tutorials/voice/python/call-transfer).
