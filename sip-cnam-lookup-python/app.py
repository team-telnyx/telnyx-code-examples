#!/usr/bin/env python3
"""Production-ready Flask API for CNAM lookup and SIP connection management."""

import os
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def lookup_cnam(phone_number: str) -> dict:
    """Perform CNAM lookup for a phone number via Telnyx REST API."""
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        raise ValueError("TELNYX_API_KEY environment variable not set")
    
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Remove the + prefix for the API endpoint
    clean_number = phone_number[1:]
    
    url = f"https://api.telnyx.com/v2/cnam_lookups/{clean_number}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 401:
        raise ValueError("Invalid API key")
    elif response.status_code == 404:
        raise ValueError("Phone number not found or CNAM data unavailable")
    elif response.status_code != 200:
        raise ValueError(f"API error: {response.status_code} - {response.text}")
    
    data = response.json()
    
    return {
        "phone_number": phone_number,
        "caller_name": data.get("data", {}).get("caller_name"),
        "country_code": data.get("data", {}).get("country_code"),
        "phone_number_type": data.get("data", {}).get("phone_number_type"),
        "carrier_name": data.get("data", {}).get("carrier_name")
    }


def get_sip_connections() -> list:
    """Retrieve SIP connections for reference."""
    response = client.sip_connections.list()
    return [
        {
            "id": c.id,
            "name": c.name,
            "username": c.username,
            "status": getattr(c, 'status', 'unknown')
        }
        for c in response.data
    ]


@app.route("/cnam/lookup", methods=["GET"])
def cnam_lookup_endpoint():
    """HTTP endpoint to perform CNAM lookup."""
    phone_number = request.args.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required parameter: 'phone_number'"}), 400
    
    try:
        result = lookup_cnam(phone_number)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400
    except Exception as e:
        return jsonify({"error": f"Lookup failed: {str(e)}"}), 500


@app.route("/sip/connections", methods=["GET"])
def list_sip_connections():
    """List SIP connections for reference."""
    try:
        connections = get_sip_connections()
        return jsonify({"connections": connections}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
