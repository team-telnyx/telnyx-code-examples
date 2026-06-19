# SMS Survey with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that conducts multi-question SMS surveys using the Telnyx Python SDK. This tutorial demonstrates how to manage survey state, handle inbound SMS responses via webhooks, track participant progress, and generate survey results—all with proper error handling and secure credential management.

## Who Is This For?

- **Python developers** building sms features with Flask.
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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A Messaging Profile configured with a webhook URL for inbound messages.
- pip (Python package manager).
- A publicly accessible URL for webhook callbacks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, survey logic, and webhook handler:

```python
#!/usr/bin/env python3
"""Production-ready Flask SMS survey application using Telnyx."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from config import SURVEY_QUESTIONS, survey_responses

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")


def start_survey(to_number: str) -> dict:
    """Initiate a survey by sending the first question to a participant."""
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initialize survey state for this participant
    survey_responses[to_number] = {
        "current_question": 0,
        "responses": [],
        "status": "in_progress",
    }
    
    # Send the first question
    first_question = SURVEY_QUESTIONS[0]
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        text=first_question["text"],
    )
    
    return {
        "participant": to_number,
        "message_id": response.data.id,
        "question_number": 1,
        "total_questions": len(SURVEY_QUESTIONS),
        "status": "survey_started",
    }


def process_survey_response(from_number: str, message_text: str) -> dict:
    """Process inbound survey response and advance to next question or complete survey."""
    if from_number not in survey_responses:
        return {
            "status": "error",
            "message": "No active survey found for this number. Reply START to begin.",
        }
    
    participant_state = survey_responses[from_number]
    
    if participant_state["status"] != "in_progress":
        return {
            "status": "error",
            "message": "Survey already completed for this participant.",
        }
    
    current_q_index = participant_state["current_question"]
    current_question = SURVEY_QUESTIONS[current_q_index]
    
    # Validate response against allowed options
    if message_text.strip() not in current_question["valid_responses"]:
        response = client.messages.create(
            from_=TELNYX_PHONE_NUMBER,
            to=from_number,
            text=f"Invalid response. {current_question['text']}",
        )
        return {
            "status": "invalid_response",
            "message_id": response.data.id,
            "message": "Response rejected. Resending question.",
        }
    
    # Record valid response
    participant_state["responses"].append({
        "question_id": current_question["id"],
        "question_text": current_question["text"],
        "response": message_text.strip(),
    })
    
    # Check if survey is complete
    if current_q_index + 1 >= len(SURVEY_QUESTIONS):
        participant_state["status"] = "completed"
        completion_message = (
            f"Thank you for completing the survey! Your responses have been recorded. "
            f"Total questions answered: {len(participant_state['responses'])}"
        )
        response = client.messages.create(
            from_=TELNYX_PHONE_NUMBER,
            to=from_number,
            text=completion_message,
        )
        return {
            "status": "survey_completed",
            "message_id": response.data.id,
            "participant": from_number,
            "responses_count": len(participant_state["responses"]),
        }
    
    # Send next question
    next_q_index = current_q_index + 1
    next_question = SURVEY_QUESTIONS[next_q_index]
    participant_state["current_question"] = next_q_index
    
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=from_number,
        text=next_question["text"],
    )
    
    return {
        "status": "question_sent",
        "message_id": response.data.id,
        "question_number": next_q_index + 1,
        "total_questions": len(SURVEY_QUESTIONS),
    }


@app.route("/survey/start", methods=["POST"])
def start_survey_endpoint():
    """HTTP endpoint to initiate a survey for a participant."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    try:
        result = start_survey(to_number)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/webhook/sms", methods=["POST"])
def webhook_sms():
    """Webhook endpoint to receive inbound SMS messages from Telnyx."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    # Extract event data from Telnyx webhook
    event_type = payload.get("data", {}).get("event_type")
    
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    message_data = payload.get("data", {})
    from_number = message_data.get("from", {}).get("phone_number")
    message_text = message_data.get("text", "").strip()
    
    if not from_number or not message_text:
        return jsonify({"error": "Missing from or text"}), 400
    
    try:
        # Handle special commands
        if message_text.upper() == "START":
            result = start_survey(from_number)
            return jsonify(result), 200
        
        # Process survey response
        result = process_survey_response(from_number, message_text)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/survey/results", methods=["GET"])
def get_survey_results():
    """HTTP endpoint to retrieve survey results for all participants."""
    results = []
    
    for participant, state in survey_responses.items():
        results.append({
            "participant": participant,
            "status": state["status"],
            "responses_count": len(state["responses"]),
            "responses": state["responses"],
        })
    
    return jsonify({
        "total_participants": len(results),
        "results": results,
    }), 200


@app.route("/survey/participant/<participant>", methods=["GET"])
def get_participant_results(participant):
    """HTTP endpoint to retrieve survey results for a specific participant."""
    if participant not in survey_responses:
        return jsonify({"error": "Participant not found"}), 404
    
    state = survey_responses[participant]
    
    return jsonify({
        "participant": participant,
        "status": state["status"],
        "responses_count": len(state["responses"]),
        "responses": state["responses"],
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving messages | The `/webhook/sms` endpoint is not being called when inbound SMS arrives. | Verify your Messaging Profile in the Telnyx Portal is configured with the correct webhook URL. Ensure the URL is publicly accessible (test with `curl https://your-ngrok-url.ngrok.io/webhook/sms`). Check that ngrok is still running and the tunnel is active. Confirm the phone number receiving messages is associated with the correct Messaging Profile. |
| Survey state not persisting | Participant responses are lost or survey state resets unexpectedly. | The in-memory `survey_responses` dictionary is cleared when the Flask server restarts. For production, implement persistent storage using a database (PostgreSQL, MongoDB, etc.) instead of in-memory storage. Store participant state with timestamps to handle timeouts and abandoned surveys. |
| Invalid response validation failing | Participants report that valid responses are rejected as invalid. | Check that response validation in `process_survey_response()` matches the exact valid options defined in `SURVEY_QUESTIONS`. Ensure case sensitivity is handled correctly (e.g., "Y" vs "y"). Test with the exact response strings shown in the survey question text. Verify that whitespace is being stripped from incoming messages with `.strip()`. |
| Rate limiting errors (429) | The application returns "Rate limit exceeded" when sending multiple survey messages. | Implement exponential backoff between API calls. Add a delay between sending the survey initiation and first question. For bulk surveys, space out survey starts across multiple seconds. Check your Telnyx account plan limits and consider upgrading if conducting large-scale surveys. |
| Authentication errors (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. Confirm the `.env` file is in the same directory as `app.py` and `load_dotenv()` is called before accessing environment variables. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
