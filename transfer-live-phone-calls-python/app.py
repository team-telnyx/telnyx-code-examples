#!/usr/bin/env python3
"""Production-ready Flask application for call transfer via Telnyx Voice API."""

import os
import json
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
    
    # Store call metadata for later transfer operations
    active_calls[call_control_id] = {
        "call_control_id": call_control_id,
        "from": from_number,
        "to": to_number,
        "status": "initiated",
    }
    
    return {
        "call_control_id": call_control_id,
        "from": from_number,
        "to": to_number,
        "status": "initiated",
    }


def transfer_call(call_control_id: str, transfer_to: str) -> dict:
    """Transfer an active call to another number."""
    if not transfer_to.startswith("+"):
        raise ValueError("Transfer number must be in E.164 format")
    
    if call_control_id not in active_calls:
        raise ValueError(f"Call {call_control_id} not found or already completed")
    
    # Execute the transfer action
    response = client.calls.actions.transfer(
        call_control_id=call_control_id,
        to=transfer_to,
    )
    
    # Update call state
    active_calls[call_control_id]["status"] = "transferred"
    active_calls[call_control_id]["transferred_to"] = transfer_to
    
    return {
        "call_control_id": call_control_id,
        "status": "transferred",
        "transferred_to": transfer_to,
    }


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    if call_control_id not in active_calls:
        raise ValueError(f"Call {call_control_id} not found")
    
    # Hangup the call
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    # Update call state
    active_calls[call_control_id]["status"] = "hangup"
    
    return {
        "call_control_id": call_control_id,
        "status": "hangup",
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
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/transfer", methods=["POST"])
def transfer_call_endpoint():
    """HTTP endpoint to transfer an active call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    call_control_id = data.get("call_control_id")
    transfer_to = data.get("transfer_to")
    
    if not call_control_id or not transfer_to:
        return jsonify({"error": "Missing required fields: 'call_control_id' and 'transfer_to'"}), 400
    
    try:
        result = transfer_call(call_control_id, transfer_to)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/calls/hangup", methods=["POST"])
def hangup_call_endpoint():
    """HTTP endpoint to terminate a call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    call_control_id = data.get("call_control_id")
    
    if not call_control_id:
        return jsonify({"error": "Missing required field: 'call_control_id'"}), 400
    
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """Webhook endpoint to receive call state change events from Telnyx."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    # Extract event metadata
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    # Log the event (in production, persist to a database)
    print(f"Webhook event: {event_type} for call {call_control_id}")
    
    # Update call state based on event type
    if event_type == "call.initiated":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.hangup":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "completed"
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/calls/status/<call_control_id>", methods=["GET"])
def get_call_status(call_control_id):
    """HTTP endpoint to retrieve the status of a call."""
    if call_control_id not in active_calls:
        return jsonify({"error": "Call not found"}), 404
    
    return jsonify(active_calls[call_control_id]), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
