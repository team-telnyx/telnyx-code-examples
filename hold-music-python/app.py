#!/usr/bin/env python3
"""Flask application for hold music functionality with Telnyx Voice API."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and their hold status
active_calls = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    response = client.calls.dial(
        from_=os.getenv("TELNYX_PHONE_NUMBER"),
        to=to_number,
        connection_id=os.getenv("TELNYX_CONNECTION_ID"),
    )
    
    call_control_id = response.data.call_control_id
    active_calls[call_control_id] = {"on_hold": False, "to_number": to_number}
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
    }


def start_hold_music(call_control_id: str) -> dict:
    """Start playing hold music for the specified call."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    # Use a royalty-free hold music URL or upload your own audio file
    hold_music_url = "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav"
    
    response = client.calls.actions.playback_start(
        call_control_id,
        audio_url=hold_music_url,
        loop=True,  # Loop the audio continuously
        overlay=False,
    )
    
    active_calls[call_control_id]["on_hold"] = True
    
    return {
        "call_control_id": call_control_id,
        "status": "hold_music_started",
        "on_hold": True,
    }


def stop_hold_music(call_control_id: str) -> dict:
    """Stop hold music and resume normal call flow."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    # Stop the current playback
    client.calls.actions.playback_stop(call_control_id)
    
    active_calls[call_control_id]["on_hold"] = False
    
    return {
        "call_control_id": call_control_id,
        "status": "hold_music_stopped",
        "on_hold": False,
    }


def get_call_status(call_control_id: str) -> dict:
    """Get current call status including hold state."""
    if call_control_id not in active_calls:
        raise ValueError("Call not found")
    
    response = client.calls.retrieve_status(call_control_id)
    call_data = active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "is_alive": response.data.is_alive,
        "on_hold": call_data["on_hold"],
        "to_number": call_data["to_number"],
    }


@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """Start a new outbound call."""
    data = request.get_json()
    
    if not data or not data.get("to"):
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    to_number = data["to"]
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        return jsonify({"error": "Phone number must be in E.164 format"}), 400
    
    try:
        result = initiate_call(to_number)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/calls/<call_control_id>/hold", methods=["POST"])
def start_hold_endpoint(call_control_id):
    """Put a call on hold with music."""
    try:
        result = start_hold_music(call_control_id)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code


@app.route("/calls/<call_control_id>/unhold", methods=["POST"])
def stop_hold_endpoint(call_control_id):
    """Remove a call from hold and stop music."""
    try:
        result = stop_hold_music(call_control_id)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code


@app.route("/calls/<call_control_id>/status", methods=["GET"])
def get_call_status_endpoint(call_control_id):
    """Get current call status and hold state."""
    try:
        result = get_call_status(call_control_id)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code


@app.route("/webhooks/voice", methods=["POST"])
def voice_webhook():
    """Handle Telnyx voice webhooks."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    call_control_id = data.get("data", {}).get("payload", {}).get("call_control_id")
    
    if event_type == "call.answered":
        # Call was answered - could automatically start hold music here
        print(f"Call {call_control_id} was answered")
        
    elif event_type == "call.hangup":
        # Clean up call data when call ends
        if call_control_id in active_calls:
            del active_calls[call_control_id]
        print(f"Call {call_control_id} ended")
        
    elif event_type == "call.playback.ended":
        # Hold music finished playing (if not looping)
        print(f"Playback ended for call {call_control_id}")
    
    return jsonify({"status": "received"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
