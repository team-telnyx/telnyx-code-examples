#!/usr/bin/env python3
"""Production-ready Flask endpoint for setting up SIP trunking via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(name: str, username: str, password: str) -> dict:
    """Create SIP connection via Telnyx and return JSON-serializable response data."""
    # Validate input to prevent API errors
    if not name or not username or not password:
        raise ValueError("Name, username, and password are required")
    
    # Use client.sip_connections.create() — NOT client.sip_connections.create()
    response = client.sip_connections.create(
        name=name,
        username=username,
        password=password,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "username": response.data.username,
    }


@app.route("/sip/setup", methods=["POST"])
def setup_sip_endpoint():
    """HTTP endpoint to set up SIP trunking."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    username = data.get("username")
    password = data.get("password")
    
    if not name or not username or not password:
        return jsonify({"error": "Missing required fields: 'name', 'username', and 'password'"}), 400
    
    try:
        result = create_sip_connection(name, username, password)
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
