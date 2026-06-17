#!/usr/bin/env python3
"""Production-ready Flask application for call forwarding via Telnyx Voice API."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for active calls (use Redis in production)
active_calls = {}


def forward_call(call_control_id: str, to_number: str) -> dict:
    """
    Transfer an active call to a new destination.
    
    Args:
        call_control_id: The unique identifier for the call to transfer.
        to_number: The destination number in E.164 format.
    
    Returns:
        Dictionary with transfer status.
    """
    if not to_number.startswith("+"):
        raise ValueError("Destination number must be in E.164 format (e.g., +15551234567)")
    
    # Use the transfer action to route the call
    response = client.calls.actions.transfer(
        call_control_id=call_control_id,
        to=to_number,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "call_control_id": response.data.call_control_id,
        "status": "transfer_initiated",
        "destination": to_number,
    }


def answer_call(call_control_id: str) -> dict:
    """
    Answer an inbound call.
    
    Args:
        call_control_id: The unique identifier for the call to answer.
    
    Returns:
        Dictionary with answer confirmation.
    """
    response = client.calls.actions.answer(call_control_id=call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "answered",
    }


def hangup_call(call_control_id: str) -> dict:
    """
    Terminate an active call.
    
    Args:
        call_control_id: The unique identifier for the call to hangup.
    
    Returns:
        Dictionary with hangup confirmation.
    """
    response = client.calls.actions.hangup(call_control_id=call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "hangup_initiated",
    }


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """
    Webhook endpoint to handle inbound call events.
    
    Telnyx sends call.initiated, call.answered, and call.hangup events here.
    This handler implements call forwarding logic.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload received"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    from_number = payload.get("data", {}).get("from")
    
    try:
        if event_type == "call.initiated":
            # Store call metadata for tracking
            active_calls[call_control_id] = {
                "from": from_number,
                "initiated_at": payload.get("data", {}).get("occurred_at"),
            }
            
            # Answer the call automatically
            answer_call(call_control_id)
            
            # Forward to the configured destination
            forward_to = os.getenv("FORWARD_TO_NUMBER")
            if not forward_to:
                raise ValueError("FORWARD_TO_NUMBER environment variable not set")
            
            forward_call(call_control_id, forward_to)
            
            return jsonify({"status": "call_forwarded"}), 200
        
        elif event_type == "call.answered":
            # Log call answer event
            if call_control_id in active_calls:
                active_calls[call_control_id]["answered_at"] = payload.get("data", {}).get("occurred_at")
            
            return jsonify({"status": "call_answered"}), 200
        
        elif event_type == "call.hangup":
            # Clean up call record
            if call_control_id in active_calls:
                del active_calls[call_control_id]
            
            return jsonify({"status": "call_ended"}), 200
        
        else:
            # Ignore other event types
            return jsonify({"status": "event_ignored"}), 200
    
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


@app.route("/calls/status/<call_control_id>", methods=["GET"])
def get_call_status(call_control_id: str):
    """
    Retrieve the status of an active call.
    
    Args:
        call_control_id: The unique identifier for the call.
    
    Returns:
        JSON with call status and metadata.
    """
    try:
        response = client.calls.retrieve_status(call_control_id)
        
        return jsonify({
            "call_control_id": response.data.call_control_id,
            "is_alive": response.data.is_alive,
            "state": response.data.state,
            "metadata": active_calls.get(call_control_id, {}),
        }), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/calls/hangup/<call_control_id>", methods=["POST"])
def hangup_call_endpoint(call_control_id: str):
    """
    Manually terminate an active call.
    
    Args:
        call_control_id: The unique identifier for the call to terminate.
    
    Returns:
        JSON with hangup confirmation.
    """
    try:
        result = hangup_call(call_control_id)
        return jsonify(result), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
