#!/usr/bin/env python3
"""Production-ready voicemail system using Telnyx Call Control API."""

import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Store active calls and their states
call_sessions = {}


def answer_call(call_control_id: str) -> dict:
    """Answer incoming call and return response data."""
    response = client.calls.actions.answer(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "answered"
    }


def play_greeting(call_control_id: str) -> dict:
    """Play voicemail greeting message."""
    greeting_text = (
        "Hello! You've reached our voicemail system. "
        "Please leave your message after the beep, and we'll get back to you soon."
    )
    
    response = client.calls.actions.speak(
        call_control_id,
        payload=greeting_text,
        voice="female",
        language="en-US"
    )
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "playing_greeting"
    }


def start_recording(call_control_id: str) -> dict:
    """Start recording the voicemail message."""
    # Generate unique filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"voicemail_{timestamp}_{call_control_id[:8]}"
    
    response = client.calls.actions.start_recording(
        call_control_id,
        format="mp3",
        channels="single",
        play_beep=True,
        # Recording will be available via webhook when complete
    )
    
    # Store recording info for this call
    call_sessions[call_control_id]["recording_filename"] = filename
    call_sessions[call_control_id]["recording_started"] = datetime.now().isoformat()
    
    return {
        "call_control_id": response.data.call_control_id,
        "status": "recording_started",
        "filename": filename
    }


def hangup_call(call_control_id: str) -> dict:
    """Hangup the call gracefully."""
    response = client.calls.actions.hangup(call_control_id)
    return {
        "call_control_id": response.data.call_control_id,
        "status": "hangup"
    }


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice_webhook():
    """Handle incoming voice webhook events."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data received"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    call_control_id = data.get("data", {}).get("payload", {}).get("call_control_id")
    
    if not call_control_id:
        return jsonify({"error": "Missing call_control_id"}), 400
    
    try:
        if event_type == "call.initiated":
            # Initialize call session tracking
            call_sessions[call_control_id] = {
                "state": "initiated",
                "start_time": datetime.now().isoformat(),
                "from_number": data.get("data", {}).get("payload", {}).get("from"),
                "to_number": data.get("data", {}).get("payload", {}).get("to")
            }
            
            # Answer the incoming call
            result = answer_call(call_control_id)
            call_sessions[call_control_id]["state"] = "answered"
            return jsonify(result)
            
        elif event_type == "call.answered":
            # Call was answered, play greeting
            result = play_greeting(call_control_id)
            call_sessions[call_control_id]["state"] = "playing_greeting"
            return jsonify(result)
            
        elif event_type == "call.speak.ended":
            # Greeting finished, start recording
            if call_sessions.get(call_control_id, {}).get("state") == "playing_greeting":
                result = start_recording(call_control_id)
                call_sessions[call_control_id]["state"] = "recording"
                return jsonify(result)
                
        elif event_type == "call.recording.saved":
            # Recording completed and saved
            recording_url = data.get("data", {}).get("payload", {}).get("recording_urls", {}).get("mp3")
            if call_control_id in call_sessions:
                call_sessions[call_control_id]["recording_url"] = recording_url
                call_sessions[call_control_id]["state"] = "recording_saved"
            
            # Optionally hangup after recording (or let caller hangup naturally)
            return jsonify({"status": "recording_saved", "url": recording_url})
            
        elif event_type == "call.hangup":
            # Call ended, clean up session
            session_data = call_sessions.pop(call_control_id, {})
            
            # Log voicemail details
            print(f"Voicemail completed:")
            print(f"  From: {session_data.get('from_number')}")
            print(f"  Duration: {session_data.get('start_time')} to {datetime.now().isoformat()}")
            print(f"  Recording: {session_data.get('recording_url', 'Not available')}")
            
            return jsonify({"status": "call_ended"})
            
        return jsonify({"status": "event_processed"})
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/voicemails", methods=["GET"])
def list_voicemails():
    """List all completed voicemail sessions."""
    # In production, store this data in a database
    completed_voicemails = []
    
    for call_id, session in call_sessions.items():
        if session.get("recording_url"):
            completed_voicemails.append({
                "call_id": call_id,
                "from_number": session.get("from_number"),
                "timestamp": session.get("start_time"),
                "recording_url": session.get("recording_url"),
                "filename": session.get("recording_filename")
            })
    
    return jsonify({"voicemails": completed_voicemails})


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "active_calls": len(call_sessions)})


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
