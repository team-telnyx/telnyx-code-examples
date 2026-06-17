#!/usr/bin/env python3
"""Production-ready Flask application for device location tracking via Telnyx IoT API."""

import os
import telnyx
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_sim_card_details(sim_card_id: str) -> dict:
    """Retrieve SIM card details including network attachment status."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "phone_number": response.data.phone_number,
        "imei": response.data.imei,
        "imsi": response.data.imsi,
    }


def get_sim_network_usage(sim_card_id: str) -> dict:
    """Fetch network usage data which includes carrier and network info."""
    # Network usage endpoint requires direct REST call via the SDK's HTTP client
    api_key = os.getenv("TELNYX_API_KEY")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    response = requests.get(url, headers=headers, timeout=10)
    
    if response.status_code == 401:
        raise telnyx.AuthenticationError("Invalid API key")
    elif response.status_code == 404:
        raise ValueError(f"SIM card {sim_card_id} not found")
    elif response.status_code == 429:
        raise telnyx.RateLimitError("Rate limit exceeded")
    elif response.status_code >= 400:
        raise telnyx.APIStatusError(f"API error: {response.status_code}")
    
    data = response.json()
    
    # Extract location-relevant fields from network usage
    if "data" in data and len(data["data"]) > 0:
        latest = data["data"][0]
        return {
            "carrier": latest.get("carrier"),
            "country": latest.get("country"),
            "network_type": latest.get("network_type"),
            "last_updated": latest.get("last_updated"),
            "data_limit": latest.get("data_limit"),
            "data_used": latest.get("data_used"),
        }
    
    return {
        "carrier": None,
        "country": None,
        "network_type": None,
        "last_updated": None,
        "data_limit": None,
        "data_used": None,
    }


def list_all_sim_cards() -> list:
    """List all SIM cards in the account with pagination support."""
    response = client.sim_cards.list()
    
    # Extract serializable data for each SIM card
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "phone_number": s.phone_number,
            "sim_card_group_id": s.sim_card_group_id,
        }
        for s in response.data
    ]


@app.route("/devices", methods=["GET"])
def list_devices():
    """List all SIM cards (devices) in the account."""
    try:
        devices = list_all_sim_cards()
        return jsonify({"devices": devices}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/devices/<sim_card_id>", methods=["GET"])
def get_device_location(sim_card_id: str):
    """Retrieve device location and network information for a specific SIM card."""
    try:
        # Validate SIM card ID format (basic check)
        if not sim_card_id or len(sim_card_id) < 5:
            return jsonify({"error": "Invalid SIM card ID format"}), 400
        
        # Fetch SIM card details
        sim_details = get_sim_card_details(sim_card_id)
        
        # Fetch network/location data
        network_data = get_sim_network_usage(sim_card_id)
        
        # Combine into location response
        location_response = {
            "device": sim_details,
            "location": {
                "carrier": network_data.get("carrier"),
                "country": network_data.get("country"),
                "network_type": network_data.get("network_type"),
                "last_updated": network_data.get("last_updated"),
            },
            "data_usage": {
                "limit_mb": network_data.get("data_limit"),
                "used_mb": network_data.get("data_used"),
            },
        }
        
        return jsonify(location_response), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404


@app.route("/devices/<sim_card_id>/location", methods=["GET"])
def get_location_only(sim_card_id: str):
    """Retrieve only location information for a device (lightweight endpoint)."""
    try:
        if not sim_card_id or len(sim_card_id) < 5:
            return jsonify({"error": "Invalid SIM card ID format"}), 400
        
        network_data = get_sim_network_usage(sim_card_id)
        
        location_response = {
            "sim_card_id": sim_card_id,
            "carrier": network_data.get("carrier"),
            "country": network_data.get("country"),
            "network_type": network_data.get("network_type"),
            "last_updated": network_data.get("last_updated"),
        }
        
        return jsonify(location_response), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint to verify API connectivity."""
    try:
        # Attempt a lightweight API call to verify authentication
        client.sim_cards.list(page={"size": 1})
        return jsonify({"status": "healthy"}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"status": "unhealthy", "reason": "Invalid API key"}), 401
    except telnyx.APIConnectionError:
        return jsonify({"status": "unhealthy", "reason": "Cannot reach Telnyx API"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
