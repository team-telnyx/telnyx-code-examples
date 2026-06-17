# OTP 2FA with Python and Flask

## What Does This Example Do?

Build a production-ready two-factor authentication (2FA) system using one-time passwords (OTPs) delivered via SMS. This tutorial demonstrates secure OTP generation, storage with expiration, verification workflows, and proper error handling using the Telnyx Python SDK with Flask. You'll create endpoints for requesting OTPs, verifying codes, and managing user sessions with time-limited tokens.

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
- A Telnyx phone number enabled for outbound SMS.
- pip (Python package manager).
- Basic understanding of Flask routing and JSON APIs.
- `curl` or Postman for testing endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Implement helper functions for OTP generation, sending, and verification:

```python
def generate_otp() -> str:
    """Generate a 6-digit OTP code."""
    return "".join(secrets.choice("0123456789") for _ in range(OTP_LENGTH))


def send_otp_sms(phone_number: str, otp_code: str) -> dict:
    """Send OTP via SMS and return response metadata."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    message_text = f"Your verification code is: {otp_code}. Valid for {OTP_EXPIRY_SECONDS // 60} minutes."
    
    response = client.messages.create(
        from_=from_number,
        to=phone_number,
        text=message_text,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "unknown",
    }


def store_otp(phone_number: str, otp_code: str) -> None:
    """Store OTP with expiration timestamp."""
    expires_at = time.time() + OTP_EXPIRY_SECONDS
    otp_store[phone_number] = {
        "code": otp_code,
        "expires_at": expires_at,
        "attempts": 0,
    }


def verify_otp(phone_number: str, provided_code: str) -> bool:
    """Verify OTP code and check expiration. Returns True if valid."""
    if phone_number not in otp_store:
        return False
    
    otp_data = otp_store[phone_number]
    
    # Check expiration
    if time.time() > otp_data["expires_at"]:
        del otp_store[phone_number]
        return False
    
    # Check attempt limit
    if otp_data["attempts"] >= MAX_VERIFICATION_ATTEMPTS:
        del otp_store[phone_number]
        return False
    
    # Increment attempt counter
    otp_data["attempts"] += 1
    
    # Verify code (constant-time comparison to prevent timing attacks)
    if secrets.compare_digest(otp_data["code"], provided_code):
        del otp_store[phone_number]  # Consume OTP after successful verification
        return True
    
    return False


def get_otp_status(phone_number: str) -> dict:
    """Get OTP status for a phone number (for debugging/testing only)."""
    if phone_number not in otp_store:
        return {"exists": False}
    
    otp_data = otp_store[phone_number]
    time_remaining = max(0, otp_data["expires_at"] - time.time())
    
    return {
        "exists": True,
        "expires_in_seconds": int(time_remaining),
        "attempts_remaining": MAX_VERIFICATION_ATTEMPTS - otp_data["attempts"],
    }
```

Now add Flask routes for requesting and verifying OTPs:

```python
@app.route("/auth/request-otp", methods=["POST"])
def request_otp():
    """Request an OTP to be sent to the provided phone number."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    try:
        # Generate and send OTP
        otp_code = generate_otp()
        sms_response = send_otp_sms(phone_number, otp_code)
        store_otp(phone_number, otp_code)
        
        return jsonify({
            "message": "OTP sent successfully",
            "message_id": sms_response["message_id"],
            "expires_in_seconds": OTP_EXPIRY_SECONDS,
        }), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please try again later."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/auth/verify-otp", methods=["POST"])
def verify_otp_endpoint():
    """Verify the OTP code provided by the user."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    otp_code = data.get("code")
    
    if not phone_number or not otp_code:
        return jsonify({"error": "Missing required fields: 'phone_number' and 'code'"}), 400
    
    # Validate code format (should be numeric)
    if not otp_code.isdigit() or len(otp_code) != OTP_LENGTH:
        return jsonify({"error": f"Code must be {OTP_LENGTH} digits"}), 400
    
    if verify_otp(phone_number, otp_code):
        # In production, generate a session token or JWT here
        session_token = secrets.token_urlsafe(32)
        return jsonify({
            "message": "OTP verified successfully",
            "session_token": session_token,
            "authenticated": True,
        }), 200
    else:
        # Check if OTP exists to provide better error messages
        status = get_otp_status(phone_number)
        if not status["exists"]:
            return jsonify({"error": "No OTP found for this phone number. Request a new one."}), 400
        elif status["attempts_remaining"] <= 0:
            return jsonify({"error": "Maximum verification attempts exceeded. Request a new OTP."}), 429
        else:
            return jsonify({
                "error": "Invalid OTP code",
                "attempts_remaining": status["attempts_remaining"],
            }), 400


@app.route("/auth/otp-status", methods=["GET"])
def otp_status():
    """Get OTP status for a phone number (for testing/debugging only)."""
    phone_number = request.args.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required query parameter: 'phone_number'"}), 400
    
    status = get_otp_status(phone_number)
    return jsonify(status), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| OTP not received | The SMS is not arriving at the phone number after calling `/auth/request-otp`. | Verify the phone number is in E.164 format (e.g., `+15551234567`). Check that your Telnyx phone number in `.env` is correct and enabled for outbound SMS. Review the message status in the Telnyx Portal to see if the SMS was queued or failed. Ensure your account has sufficient credits. |
| "Invalid API key" (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| OTP expires too quickly | The OTP status shows `expires_in_seconds: 0` or the verification fails with "No OTP found". | Check the `OTP_EXPIRY_SECONDS` value in your `.env` file. The default is 300 seconds (5 minutes). Increase this value if users need more time to receive and enter the code. Remember that in-memory storage is lost if the server restarts—use Redis or a database for production. |
| Maximum attempts exceeded | After 3 failed verification attempts, the endpoint returns "Maximum verification attempts exceeded". | The OTP is automatically deleted after 3 incorrect attempts for security. The user must request a new OTP by calling `/auth/request-otp` again. Consider implementing rate limiting on the request endpoint to prevent abuse. |
| Phone number format error | The endpoint returns "Phone number must be in E.164 format". | Ensure the phone number starts with `+` followed by the country code and number without spaces or dashes. Examples: `+15551234567` (US), `+447700900123` (UK), `+33123456789` (France). Update your test curl command to use properly formatted numbers. |

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

- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Build Two-Way SMS Conversations](/tutorials/sms/python/two-way-sms).
