#!/usr/bin/env python3
"""Production-ready OTP 2FA system with Flask and Telnyx SMS."""

import os
import secrets
import time
from dotenv import load_dotenv
import telnyx
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory OTP storage: {phone_number: {"code": "123456", "expires_at": timestamp, "attempts": 0}}
# For production, use Redis or a database with TTL support
otp_store = {}

# Configuration
OTP_LENGTH = 6
OTP_EXPIRY_SECONDS = int(os.getenv("OTP_EXPIRY_SECONDS", "300"))
MAX_VERIFICATION_ATTEMPTS = 3


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
