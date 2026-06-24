#!/usr/bin/env python3
"""Call analytics system with Flask and Telnyx Call Control API."""

import os
import telnyx
from datetime import datetime
from typing import Dict, List, Optional
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


class CallAnalytics:
    """In-memory call analytics storage and calculation."""
    
    def __init__(self):
        self.calls: Dict[str, dict] = {}
        self.events: List[dict] = []
    
    def track_call_initiated(self, call_control_id: str, from_number: str, to_number: str) -> None:
        """Record a new outbound call initiation."""
        self.calls[call_control_id] = {
            "call_control_id": call_control_id,
            "from": from_number,
            "to": to_number,
            "status": "initiated",
            "start_time": datetime.utcnow().isoformat(),
            "end_time": None,
            "duration_seconds": None,
            "answered": False,
        }
        
        self.events.append({
            "event_type": "call.initiated",
            "call_control_id": call_control_id,
            "timestamp": datetime.utcnow().isoformat(),
        })
    
    def track_call_answered(self, call_control_id: str) -> None:
        """Mark a call as answered."""
        if call_control_id in self.calls:
            self.calls[call_control_id]["status"] = "answered"
            self.calls[call_control_id]["answered"] = True
            
        self.events.append({
            "event_type": "call.answered",
            "call_control_id": call_control_id,
            "timestamp": datetime.utcnow().isoformat(),
        })
    
    def track_call_hangup(self, call_control_id: str, hangup_cause: Optional[str] = None) -> None:
        """Record call completion and calculate duration."""
        if call_control_id in self.calls:
            call = self.calls[call_control_id]
            call["status"] = "completed"
            call["end_time"] = datetime.utcnow().isoformat()
            call["hangup_cause"] = hangup_cause
            
            # Calculate duration if call was answered
            if call["start_time"] and call["end_time"]:
                start = datetime.fromisoformat(call["start_time"])
                end = datetime.fromisoformat(call["end_time"])
                call["duration_seconds"] = int((end - start).total_seconds())
        
        self.events.append({
            "event_type": "call.hangup",
            "call_control_id": call_control_id,
            "timestamp": datetime.utcnow().isoformat(),
            "hangup_cause": hangup_cause,
        })
    
    def get_call_metrics(self) -> dict:
        """Calculate aggregate call metrics."""
        total_calls = len(self.calls)
        answered_calls = sum(1 for call in self.calls.values() if call["answered"])
        completed_calls = sum(1 for call in self.calls.values() if call["status"] == "completed")
        
        # Calculate average duration for answered calls
        durations = [
            call["duration_seconds"] 
            for call in self.calls.values() 
            if call["duration_seconds"] is not None
        ]
        avg_duration = sum(durations) / len(durations) if durations else 0
        
        # Calculate answer rate
        answer_rate = (answered_calls / total_calls * 100) if total_calls > 0 else 0
        
        return {
            "total_calls": total_calls,
            "answered_calls": answered_calls,
            "completed_calls": completed_calls,
            "answer_rate_percent": round(answer_rate, 2),
            "average_duration_seconds": round(avg_duration, 2),
            "total_events": len(self.events),
        }
    
    def get_recent_calls(self, limit: int = 10) -> List[dict]:
        """Get most recent calls with full details."""
        calls_list = list(self.calls.values())
        # Sort by start_time descending
        calls_list.sort(key=lambda x: x["start_time"], reverse=True)
        return calls_list[:limit]


# Initialize analytics tracker
analytics = CallAnalytics()


def initiate_call(to_number: str) -> dict:
    """Start an outbound call and track it in analytics."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number or not connection_id:
        raise ValueError("Missing required environment variables")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initiate the call using Call Control API
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    call_control_id = response.data.call_control_id
    
    # Track the call initiation in analytics
    analytics.track_call_initiated(call_control_id, from_number, to_number)
    
    return {
        "call_control_id": call_control_id,
        "from": from_number,
        "to": to_number,
        "status": "initiated",
    }


@app.route("/calls/initiate", methods=["POST"])
def initiate_call_endpoint():
    """HTTP endpoint to start a new call."""
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


@app.route("/webhooks/call-events", methods=["POST"])
def handle_call_webhook():
    """Process incoming call control webhooks for analytics tracking."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    event_type = data.get("data", {}).get("event_type")
    payload = data.get("data", {}).get("payload", {})
    call_control_id = payload.get("call_control_id")
    
    if not event_type or not call_control_id:
        return jsonify({"error": "Missing required webhook fields"}), 400
    
    # Process different call events for analytics
    if event_type == "call.answered":
        analytics.track_call_answered(call_control_id)
    elif event_type == "call.hangup":
        hangup_cause = payload.get("hangup_cause")
        analytics.track_call_hangup(call_control_id, hangup_cause)
    
    return jsonify({"status": "processed", "event_type": event_type}), 200


@app.route("/analytics/metrics", methods=["GET"])
def get_analytics_metrics():
    """Get aggregate call analytics and metrics."""
    try:
        metrics = analytics.get_call_metrics()
        return jsonify(metrics), 200
    except Exception as e:
        return jsonify({"error": f"Failed to calculate metrics: {str(e)}"}), 500


@app.route("/analytics/calls", methods=["GET"])
def get_recent_calls():
    """Get list of recent calls with details."""
    try:
        limit = request.args.get("limit", 10, type=int)
        calls = analytics.get_recent_calls(limit)
        return jsonify({"calls": calls}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to retrieve calls: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
