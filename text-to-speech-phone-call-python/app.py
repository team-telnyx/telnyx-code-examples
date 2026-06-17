#!/usr/bin/env python3
"""Production-ready Flask application for text-to-speech calls via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for active calls (use a database in production)
active_calls = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using Call Control
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    # Extract call_control_id from response — this is returned by the API
    call_control_id = response.data.call_control_id
    
    # Store call metadata for webhook processing
    active_calls[call_control_id] = {
        "to": to_number,
        "from": from_number,
        "status": "initiated",
    }
    
    return {
        "call_control_id": call_control_id,
        "to": to_number,
        "from": from_number,
        "status": "initiated",
    }


def speak_text(call_control_id: str, text: str, language: str = "en-US") -> dict:
    """Play text-to-speech message on an active call."""
    # Use the Call Control speak action to play TTS
    response = client.calls.actions.speak(
        call_control_id=call_control_id,
        payload=text,
        language=language,
    )
    
    return {
        "call_control_id": call_control_id,
        "message": "TTS playback initiated",
        "text": text,
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    # Clean up call tracking
    if call_control_id in active_calls:
        del active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup_initiated",
    }


@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """HTTP endpoint to initiate an outbound call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    try:
        result = initiate_call(to_number)
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


@app.route("/calls/<call_control_id>/speak", methods=["POST"])
def speak_endpoint(call_control_id):
    """HTTP endpoint to play TTS on an active call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    text = data.get("text")
    language = data.get("language", "en-US")
    
    if not text:
        return jsonify({"error": "Missing required field: 'text'"}), 400
    
    try:
        result = speak_text(call_control_id, text, language)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/calls/<call_control_id>/hangup", methods=["POST"])
def hangup_endpoint(call_control_id):
    """HTTP endpoint to terminate a call."""
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """Webhook endpoint to receive Call Control events."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log event for debugging
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Handle different call events
    if event_type == "call.initiated":
        # Call has been initiated — ready for TTS
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        # Call has been answered — can now play TTS
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.speak.ended":
        # TTS playback has finished
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "speak_ended"
    
    elif event_type == "call.hangup":
        # Call has ended — clean up
        if call_control_id in active_calls:
            del active_calls[call_control_id]
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/status", methods=["GET"])
def get_calls_status():
    """HTTP endpoint to retrieve status of all active calls."""
    return jsonify({"active_calls": active_calls}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
