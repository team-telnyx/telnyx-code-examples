#!/usr/bin/env python3
"""Production-ready Flask application for warm call transfers via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and transfer states
active_calls = {}
transfer_sessions = {}


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call and return call control ID."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("Missing required environment variables")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format")
    
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    return {
        "call_control_id": response.data.call_control_id,
        "from": from_number,
        "to": to_number,
    }


def perform_warm_transfer(call_control_id: str, transfer_to: str) -> dict:
    """Initiate warm transfer by calling the transfer target first."""
    # Store the original call info
    if call_control_id not in active_calls:
        raise ValueError("Original call not found")
    
    # Initiate call to transfer target
    transfer_call = initiate_call(transfer_to)
    transfer_call_id = transfer_call["call_control_id"]
    
    # Store transfer session info
    transfer_sessions[transfer_call_id] = {
        "original_call_id": call_control_id,
        "transfer_to": transfer_to,
        "status": "connecting"
    }
    
    return {
        "transfer_call_id": transfer_call_id,
        "original_call_id": call_control_id,
        "status": "connecting_transfer_target"
    }


def complete_transfer(original_call_id: str, transfer_call_id: str) -> dict:
    """Complete the warm transfer by bridging calls."""
    response = client.calls.actions.transfer(
        call_control_id=original_call_id,
        to=transfer_call_id,
    )
    
    # Clean up transfer session
    if transfer_call_id in transfer_sessions:
        transfer_sessions[transfer_call_id]["status"] = "completed"
    
    return {
        "original_call_id": original_call_id,
        "transfer_call_id": transfer_call_id,
        "status": "transfer_completed"
    }


@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """Start an outbound call."""
    data = request.get_json()
    
    if not data or not data.get("to"):
        return jsonify({"error": "Missing 'to' phone number"}), 400
    
    try:
        result = initiate_call(data["to"])
        # Store call info for transfer operations
        active_calls[result["call_control_id"]] = {
            "to": result["to"],
            "from": result["from"],
            "status": "initiated"
        }
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/warm-transfer", methods=["POST"])
def warm_transfer_endpoint():
    """Initiate a warm transfer."""
    data = request.get_json()
    
    if not data or not data.get("call_control_id") or not data.get("transfer_to"):
        return jsonify({"error": "Missing 'call_control_id' or 'transfer_to'"}), 400
    
    try:
        result = perform_warm_transfer(data["call_control_id"], data["transfer_to"])
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/complete-transfer", methods=["POST"])
def complete_transfer_endpoint():
    """Complete the warm transfer by bridging calls."""
    data = request.get_json()
    
    required_fields = ["original_call_id", "transfer_call_id"]
    if not data or not all(data.get(field) for field in required_fields):
        return jsonify({"error": f"Missing required fields: {required_fields}"}), 400
    
    try:
        result = complete_transfer(data["original_call_id"], data["transfer_call_id"])
        return jsonify(result), 200
        
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code


@app.route("/webhooks/voice", methods=["POST"])
def voice_webhook():
    """Handle Telnyx voice webhooks."""
    data = request.get_json()
    
    if not data or not data.get("data"):
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    event_type = data["data"].get("event_type")
    call_control_id = data["data"].get("call_control_id")
    
    if event_type == "call.answered":
        # Update call status when answered
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
        
        # Check if this is a transfer target call
        if call_control_id in transfer_sessions:
            transfer_sessions[call_control_id]["status"] = "answered"
            print(f"Transfer target answered: {call_control_id}")
    
    elif event_type == "call.hangup":
        # Clean up call data
        if call_control_id in active_calls:
            del active_calls[call_control_id]
        if call_control_id in transfer_sessions:
            del transfer_sessions[call_control_id]
    
    return jsonify({"status": "received"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
