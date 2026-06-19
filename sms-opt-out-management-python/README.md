# Opt Out Management with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that manages SMS opt-out preferences using the Telnyx Python SDK. This tutorial demonstrates how to track user consent, prevent messages to opted-out numbers, handle inbound opt-out requests via webhooks, and maintain a persistent opt-out list. You'll learn to integrate webhook handling for inbound SMS, validate opt-out status before sending, and implement proper error handling for telecom workflows.

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
- pip (Python package manager).
- A publicly accessible URL for webhook callbacks (use ngrok for local development).
- SQLite3 (included with Python) or PostgreSQL for opt-out storage.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-opt-out-management-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-opt-out-management-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, Telnyx client initialization, and opt-out management logic:

```python
import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from database import (
    init_db, is_opted_out, add_optout, remove_optout, get_optout_list, log_message
)

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Initialize database on startup
init_db()


def send_sms(to_number: str, message: str) -> dict:
    """
    Send SMS via Telnyx after checking opt-out status.
    Raises ValueError if recipient is opted out.
    """
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Check opt-out status before sending
    if is_opted_out(to_number):
        raise ValueError(f"Recipient {to_number} has opted out of SMS messages")
    
    # Send message via Telnyx
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Log the message
    status = response.data.to[0].status if response.data.to else "unknown"
    log_message(
        message_id=response.data.id,
        from_number=from_number,
        to_number=to_number,
        direction="outbound",
        status=status
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": status,
        "from": from_number,
        "to": to_number,
    }


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send SMS with opt-out checking."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_sms(to_number, message)
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


@app.route("/optout/add", methods=["POST"])
def add_optout_endpoint():
    """Manually add a phone number to the opt-out list."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    reason = data.get("reason")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    if not phone_number.startswith("+"):
        return jsonify({"error": "Phone number must be in E.164 format"}), 400
    
    result = add_optout(phone_number, reason=reason, source="manual")
    return jsonify(result), 200


@app.route("/optout/remove", methods=["POST"])
def remove_optout_endpoint():
    """Remove a phone number from the opt-out list."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    result = remove_optout(phone_number)
    return jsonify(result), 200


@app.route("/optout/list", methods=["GET"])
def list_optouts_endpoint():
    """Retrieve all opted-out phone numbers."""
    optouts = get_optout_list()
    return jsonify({"optouts": optouts, "count": len(optouts)}), 200


@app.route("/optout/check", methods=["POST"])
def check_optout_endpoint():
    """Check if a phone number is opted out."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    opted_out = is_opted_out(phone_number)
    return jsonify({"phone_number": phone_number, "opted_out": opted_out}), 200


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    """
    Handle inbound SMS webhooks from Telnyx.
    Automatically opt out users who reply with 'STOP' or 'UNSUBSCRIBE'.
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    # Extract webhook event data
    event_type = data.get("data", {}).get("event_type")
    
    # Only process message.received events
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    message_data = data.get("data", {})
    from_number = message_data.get("from", {}).get("phone_number")
    text = message_data.get("text", "").upper().strip()
    message_id = message_data.get("id")
    
    # Log the inbound message
    if message_id and from_number:
        log_message(
            message_id=message_id,
            from_number=from_number,
            to_number=os.getenv("TELNYX_PHONE_NUMBER"),
            direction="inbound",
            status="received"
        )
    
    # Check for opt-out keywords
    if from_number and text in ["STOP", "UNSUBSCRIBE", "STOPALL", "QUIT"]:
        add_optout(from_number, reason=f"User replied with: {text}", source="webhook")
        return jsonify({"status": "opted_out", "phone_number": from_number}), 200
    
    return jsonify({"status": "processed"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Opt-out check fails silently | Messages are sent to opted-out numbers despite the opt-out list containing the recipient. | Verify the phone number format matches exactly in both the opt-out list and the send request (including country code and `+` prefix). Check the database file exists at the path specified by `DB_PATH` environment variable. Run `sqlite3 optout.db "SELECT * FROM optouts;"` to inspect the database directly. |
| Webhook not receiving inbound SMS | The `/webhooks/sms` endpoint is not being called when users reply to messages. | Confirm your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) has the webhook URL configured correctly and is publicly accessible (not localhost). Use ngrok (`ngrok http 5000`) to expose your local Flask server and update the webhook URL in the portal. Verify the inbound SMS feature is enabled on your Telnyx phone number. Check Flask logs for incoming POST requests to `/webhooks/sms`. |
| Database locked error | SQLite returns "database is locked" when multiple requests try to access the database simultaneously. | SQLite has limited concurrent write support. For production use, migrate to PostgreSQL by replacing the `sqlite3` calls with a PostgreSQL driver like `psycopg2`. Alternatively, add connection pooling and retry logic with exponential backoff. Ensure only one Flask worker process is running (set `workers=1` if using Gunicorn). |
| Phone number format validation fails | The endpoint rejects valid phone numbers with "Phone number must be in E.164 format". | Ensure phone numbers start with `+` followed by the country code and number without spaces, dashes, or parentheses. Example: `+15551234567` (US), `+447700900123` (UK), `+33123456789` (France). Test with a known valid number from your region. |
| Webhook events not triggering opt-out | Users reply with "STOP" but are not added to the opt-out list. | Verify the webhook payload structure matches the expected format by logging the raw request data. Check that `event_type` is exactly `"message.received"` (case-sensitive). Ensure the `from` field contains a `phone_number` key. Add debug logging to the webhook handler to inspect incoming data: `app.logger.info(f"Webhook data: {data}")`. |

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
