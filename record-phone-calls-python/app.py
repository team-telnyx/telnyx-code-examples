#!/usr/bin/env python3
"""Production-ready Flask application for call recording via Telnyx Voice API."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for call state (use a database in production)
call_state = {}


def initiate_call_with_recording(to_number: str) -> dict:
    """
    Initiate an outbound call and prepare for recording.
    Returns call_control_id for subsequent control actions.
    """
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    if not connection_id:
        raise ValueError("TELNYX_CONNECTION_ID environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using Call Control API
    # connection_id is the Call Control Application ID (static config)
    # call_control_id is returned in the response (per-call runtime value)
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    # Store call metadata for webhook processing
    call_state[call_control_id] = {
        "to": to_number,
        "from": from_number,
        "status": "initiated",
        "recording_id": None,
    }
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
        "to": to_number,
        "from": from_number,
    }


def start_recording(call_control_id: str) -> dict:
    """Start recording an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    # Start recording with dual channel (both sides of the call)
    response = client.calls.actions.start_recording(
        call_control_id=call_control_id,
        format="wav",
        channels="dual",
    )
    
    # Extract recording ID from response
    recording_id = response.data.recording_id if hasattr(response.data, "recording_id") else None
    call_state[call_control_id]["recording_id"] = recording_id
    
    return {
        "call_control_id": call_control_id,
        "recording_id": recording_id,
        "status": "recording",
    }


def stop_recording(call_control_id: str) -> dict:
    """Stop recording an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    response = client.calls.actions.stop_recording(call_control_id=call_control_id)
    
    return {
        "call_control_id": call_control_id,
        "status": "recording_stopped",
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    if call_control_id not in call_state:
        raise ValueError(f"Call {call_control_id} not found in state")
    
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    call_state[call_control_id]["status"] = "hangup_requested"
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup_requested",
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
        result = initiate_call_with_recording(to_number)
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


@app.route("/calls/<call_control_id>/recording/start", methods=["POST"])
def start_recording_endpoint(call_control_id):
    """HTTP endpoint to start recording an active call."""
    try:
        result = start_recording(call_control_id)
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


@app.route("/calls/<call_control_id>/recording/stop", methods=["POST"])
def stop_recording_endpoint(call_control_id):
    """HTTP endpoint to stop recording an active call."""
    try:
        result = stop_recording(call_control_id)
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


@app.route("/calls/<call_control_id>/hangup", methods=["POST"])
def hangup_endpoint(call_control_id):
    """HTTP endpoint to terminate an active call."""
    try:
        result = hangup_call(call_control_id)
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


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """
    Webhook endpoint to receive call state change events from Telnyx.
    Automatically starts recording when call is answered.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log the event for debugging
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Handle call.answered event — automatically start recording
    if event_type == "call.answered" and call_control_id:
        if call_control_id in call_state:
            call_state[call_control_id]["status"] = "answered"
            
            # Automatically start recording when call is answered
            try:
                start_recording(call_control_id)
                print(f"Recording started for call {call_control_id}")
            except Exception as e:
                print(f"Failed to start recording: {e}")
    
    # Handle call.hangup event — clean up state
    elif event_type == "call.hangup" and call_control_id:
        if call_control_id in call_state:
            call_state[call_control_id]["status"] = "hangup"
    
    # Handle call.recording.saved event — recording is ready
    elif event_type == "call.recording.saved" and call_control_id:
        if call_control_id in call_state:
            recording_url = payload.get("data", {}).get("recording_url")
            call_state[call_control_id]["recording_url"] = recording_url
            print(f"Recording saved for call {call_control_id}: {recording_url}")
    
    # Return 200 OK to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/<call_control_id>/status", methods=["GET"])
def get_call_status(call_control_id):
    """HTTP endpoint to retrieve call status and recording info."""
    if call_control_id not in call_state:
        return jsonify({"error": "Call not found"}), 404
    
    return jsonify(call_state[call_control_id]), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
