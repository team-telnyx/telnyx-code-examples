#!/usr/bin/env python3
"""Production-ready Flask application for managing conference calls via Telnyx."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for conference state (use a database in production)
conferences = {}


def create_conference(conference_name: str, participants: list) -> dict:
    """
    Create a conference and initiate calls to all participants.
    
    Args:
        conference_name: Unique identifier for the conference.
        participants: List of phone numbers in E.164 format.
    
    Returns:
        Dictionary with conference_id and call_control_ids for each participant.
    """
    if not conference_name or not participants:
        raise ValueError("Conference name and participants list are required")
    
    # Validate phone numbers
    for phone in participants:
        if not phone.startswith("+"):
            raise ValueError(f"Phone number {phone} must be in E.164 format")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set")
    
    # Initialize conference state
    conferences[conference_name] = {
        "created_at": datetime.utcnow().isoformat(),
        "participants": {},
        "status": "active",
    }
    
    call_control_ids = []
    
    # Initiate calls to each participant
    for participant_number in participants:
        try:
            response = client.calls.dial(
                from_=from_number,
                to=participant_number,
                connection_id=connection_id,
            )
            
            call_control_id = response.data.call_control_id
            call_control_ids.append(call_control_id)
            
            # Store participant state
            conferences[conference_name]["participants"][call_control_id] = {
                "phone_number": participant_number,
                "status": "initiated",
                "joined_at": None,
            }
            
        except telnyx.APIStatusError as e:
            # Log error but continue with other participants
            print(f"Failed to dial {participant_number}: {e}")
    
    return {
        "conference_id": conference_name,
        "call_control_ids": call_control_ids,
        "participant_count": len(call_control_ids),
    }


def add_participant_to_conference(conference_name: str, phone_number: str) -> dict:
    """Add a new participant to an existing conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    if not phone_number.startswith("+"):
        raise ValueError(f"Phone number {phone_number} must be in E.164 format")
    
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    response = client.calls.dial(
        from_=from_number,
        to=phone_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    conferences[conference_name]["participants"][call_control_id] = {
        "phone_number": phone_number,
        "status": "initiated",
        "joined_at": None,
    }
    
    return {
        "call_control_id": call_control_id,
        "phone_number": phone_number,
    }


def end_conference(conference_name: str) -> dict:
    """Hang up all participants in a conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    conference = conferences[conference_name]
    hangup_count = 0
    
    for call_control_id in conference["participants"].keys():
        try:
            client.calls.actions.hangup(call_control_id)
            hangup_count += 1
        except telnyx.APIStatusError as e:
            print(f"Failed to hangup {call_control_id}: {e}")
    
    conference["status"] = "ended"
    conference["ended_at"] = datetime.utcnow().isoformat()
    
    return {
        "conference_id": conference_name,
        "hangup_count": hangup_count,
    }


def get_conference_status(conference_name: str) -> dict:
    """Retrieve the current state of a conference."""
    if conference_name not in conferences:
        raise ValueError(f"Conference {conference_name} not found")
    
    conference = conferences[conference_name]
    
    return {
        "conference_id": conference_name,
        "status": conference["status"],
        "created_at": conference["created_at"],
        "participant_count": len(conference["participants"]),
        "participants": [
            {
                "call_control_id": cid,
                "phone_number": data["phone_number"],
                "status": data["status"],
                "joined_at": data["joined_at"],
            }
            for cid, data in conference["participants"].items()
        ],
    }


@app.route("/conference/create", methods=["POST"])
def create_conference_endpoint():
    """HTTP endpoint to create a new conference."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    conference_name = data.get("conference_name")
    participants = data.get("participants", [])
    
    if not conference_name or not participants:
        return jsonify({
            "error": "Missing required fields: 'conference_name' and 'participants'"
        }), 400
    
    try:
        result = create_conference(conference_name, participants)
        return jsonify(result), 201
        
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


@app.route("/conference/<conference_name>/add-participant", methods=["POST"])
def add_participant_endpoint(conference_name):
    """HTTP endpoint to add a participant to an existing conference."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    try:
        result = add_participant_to_conference(conference_name, phone_number)
        return jsonify(result), 201
        
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


@app.route("/conference/<conference_name>/end", methods=["POST"])
def end_conference_endpoint(conference_name):
    """HTTP endpoint to end a conference and hang up all participants."""
    try:
        result = end_conference(conference_name)
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


@app.route("/conference/<conference_name>/status", methods=["GET"])
def get_conference_status_endpoint(conference_name):
    """HTTP endpoint to retrieve conference status."""
    try:
        result = get_conference_status(conference_name)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """
    Webhook endpoint to receive call control events from Telnyx.
    
    Events include: call.initiated, call.answered, call.hangup, etc.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    
    print(f"Received event: {event_type} for call {call_control_id}")
    
    # Update participant status based on event
    if event_type == "call.answered":
        for conference_name, conference in conferences.items():
            if call_control_id in conference["participants"]:
                conference["participants"][call_control_id]["status"] = "answered"
                conference["participants"][call_control_id]["joined_at"] = datetime.utcnow().isoformat()
                print(f"Participant {call_control_id} joined conference {conference_name}")
    
    elif event_type == "call.hangup":
        for conference_name, conference in conferences.items():
            if call_control_id in conference["participants"]:
                conference["participants"][call_control_id]["status"] = "hangup"
                print(f"Participant {call_control_id} left conference {conference_name}")
    
    # Return 200 OK to acknowledge receipt
    return jsonify({"status": "received"}), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
