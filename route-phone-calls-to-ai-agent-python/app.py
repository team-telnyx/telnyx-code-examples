#!/usr/bin/env python3
"""Production-ready Flask webhook for handling inbound calls via Telnyx Voice API."""

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


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """Webhook endpoint to handle inbound call events."""
    try:
        payload = request.get_json()
        
        if not payload:
            return jsonify({"error": "No payload received"}), 400
        
        # Extract event type and call control ID from webhook payload
        event_type = payload.get("data", {}).get("event_type")
        call_control_id = payload.get("data", {}).get("call_control_id")
        
        if not event_type or not call_control_id:
            return jsonify({"error": "Missing event_type or call_control_id"}), 400
        
        # Handle call.initiated event — inbound call received
        if event_type == "call.initiated":
            from_number = payload.get("data", {}).get("from", {}).get("phone_number")
            to_number = payload.get("data", {}).get("to", {}).get("phone_number")
            
            # Answer the call
            answer_call(call_control_id)
            
            # Play greeting message
            speak_to_call(
                call_control_id,
                "Thank you for calling. Your call is important to us. Goodbye."
            )
            
            return jsonify({
                "status": "call_answered",
                "call_control_id": call_control_id,
                "from": from_number,
                "to": to_number,
            }), 200
        
        # Handle call.answered event — call was answered
        elif event_type == "call.answered":
            return jsonify({
                "status": "call_answered",
                "call_control_id": call_control_id,
            }), 200
        
        # Handle call.hangup event — call ended
        elif event_type == "call.hangup":
            hangup_reason = payload.get("data", {}).get("hangup_reason")
            return jsonify({
                "status": "call_ended",
                "call_control_id": call_control_id,
                "hangup_reason": hangup_reason,
            }), 200
        
        # Handle call.speak.ended event — TTS playback finished
        elif event_type == "call.speak.ended":
            # Hangup after message finishes
            hangup_call(call_control_id)
            return jsonify({
                "status": "message_finished",
                "call_control_id": call_control_id,
            }), 200
        
        # Acknowledge other events without processing
        else:
            return jsonify({
                "status": "event_received",
                "event_type": event_type,
            }), 200
    
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
