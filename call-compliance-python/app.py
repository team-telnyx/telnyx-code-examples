#!/usr/bin/env python3
"""Production-ready Flask application for call compliance with Telnyx Voice API."""

import os
import json
import telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory storage for compliance records
COMPLIANCE_FILE = "compliance_records.json"


def load_compliance_records():
    """Load compliance records from JSON file."""
    try:
        with open(COMPLIANCE_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_compliance_records(records):
    """Save compliance records to JSON file."""
    with open(COMPLIANCE_FILE, 'w') as f:
        json.dump(records, f, indent=2)


def initiate_compliance_call(to_number: str) -> dict:
    """Initiate an outbound call with compliance features enabled."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("Missing required environment variables")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
        # Enable call recording for compliance
        record="record-from-answer",
        record_format="mp3",
        record_channels="dual",
    )
    
    # Initialize compliance record
    call_control_id = response.data.call_control_id
    records = load_compliance_records()
    records[call_control_id] = {
        "call_control_id": call_control_id,
        "to_number": to_number,
        "from_number": from_number,
        "initiated_at": datetime.utcnow().isoformat(),
        "consent_given": False,
        "recording_started": False,
        "compliance_status": "pending",
    }
    save_compliance_records(records)
    
    return {
        "call_control_id": call_control_id,
        "status": "initiated",
        "compliance_tracking": True,
    }


def handle_call_answered(call_control_id: str):
    """Handle call answered event - play consent message."""
    # Play consent message and collect DTMF response
    client.calls.actions.speak(
        call_control_id=call_control_id,
        payload="This call may be recorded for quality and compliance purposes. Press 1 to consent to recording, or press 2 to decline.",
        voice="female",
        language="en-US",
    )
    
    # Gather DTMF input for consent
    client.calls.actions.gather_using_speak(
        call_control_id=call_control_id,
        payload="Press 1 to consent or 2 to decline recording.",
        voice="female",
        language="en-US",
        valid_digits="12",
        max=1,
        timeout_millis=10000,
    )


def handle_dtmf_received(call_control_id: str, digit: str):
    """Process DTMF consent response."""
    records = load_compliance_records()
    
    if call_control_id not in records:
        return
    
    record = records[call_control_id]
    
    if digit == "1":
        # Consent given - start recording
        record["consent_given"] = True
        record["compliance_status"] = "compliant"
        
        client.calls.actions.start_recording(
            call_control_id=call_control_id,
            format="mp3",
            channels="dual",
        )
        
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload="Thank you for your consent. Recording has started. You will now be connected.",
            voice="female",
            language="en-US",
        )
        
    elif digit == "2":
        # Consent declined - proceed without recording
        record["consent_given"] = False
        record["compliance_status"] = "no_consent"
        
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload="Recording declined. Proceeding with unrecorded call.",
            voice="female",
            language="en-US",
        )
    
    record["consent_processed_at"] = datetime.utcnow().isoformat()
    save_compliance_records(records)


def handle_call_hangup(call_control_id: str):
    """Handle call hangup - finalize compliance record."""
    records = load_compliance_records()
    
    if call_control_id in records:
        records[call_control_id]["ended_at"] = datetime.utcnow().isoformat()
        records[call_control_id]["status"] = "completed"
        save_compliance_records(records)


@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """HTTP endpoint to initiate compliance-enabled call."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    try:
        result = initiate_compliance_call(to_number)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/webhooks/voice", methods=["POST"])
def voice_webhook():
    """Handle Telnyx voice webhooks for compliance tracking."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    payload = data.get("data", {}).get("payload", {})
    call_control_id = payload.get("call_control_id")
    
    if not call_control_id:
        return jsonify({"status": "ignored"}), 200
    
    try:
        if event_type == "call.answered":
            handle_call_answered(call_control_id)
        elif event_type == "call.dtmf.received":
            digit = payload.get("digit")
            if digit:
                handle_dtmf_received(call_control_id, digit)
        elif event_type == "call.hangup":
            handle_call_hangup(call_control_id)
        
        return jsonify({"status": "processed"}), 200
        
    except Exception as e:
        app.logger.error(f"Webhook processing error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/compliance/records", methods=["GET"])
def get_compliance_records():
    """Retrieve compliance records for audit purposes."""
    try:
        records = load_compliance_records()
        return jsonify({"records": list(records.values())}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/compliance/records/<call_control_id>", methods=["GET"])
def get_compliance_record(call_control_id):
    """Retrieve specific compliance record."""
    try:
        records = load_compliance_records()
        record = records.get(call_control_id)
        
        if not record:
            return jsonify({"error": "Record not found"}), 404
        
        return jsonify(record), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
