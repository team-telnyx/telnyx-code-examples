#!/usr/bin/env python3
"""Production-ready Flask endpoint for initiating outbound calls via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def initiate_call(to_number: str) -> dict:
    """Initiate an outbound call via Telnyx and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    if not connection_id:
        raise ValueError("TELNYX_CONNECTION_ID environment variable not set")
    
    # Validate E.164 format to prevent API errors
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Use client.calls.dial() to initiate the call
    # connection_id is REQUIRED and links the call to your Call Control Application
    # call_control_id is RETURNED in the response — do NOT pass it as input
    response = client.calls.dial(
        from_=from_number,
        to=to_number,
        connection_id=connection_id,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "call_control_id": response.data.call_control_id,
        "from": from_number,
        "to": to_number,
        "state": response.data.state,
    }


@app.route("/calls/dial", methods=["POST"])
def dial_call_endpoint():
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
