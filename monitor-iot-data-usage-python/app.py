#!/usr/bin/env python3
"""Production-ready Flask application for monitoring SIM card data usage via Telnyx IoT API."""

import os
import telnyx
import requests
from dotenv import load_dotenv
from datetime import datetime
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

DATA_LIMIT_THRESHOLD_MB = int(os.getenv("DATA_LIMIT_THRESHOLD_MB", "500"))


def get_sim_card_details(sim_card_id: str) -> dict:
    """Retrieve SIM card information and return JSON-serializable data."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "phone_number": response.data.phone_number,
    }


def list_all_sim_cards() -> list:
    """List all SIM cards in the account and return JSON-serializable data."""
    response = client.sim_cards.list()
    
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "sim_card_group_id": s.sim_card_group_id,
            "phone_number": s.phone_number,
        }
        for s in response.data
    ]


def get_data_usage(sim_card_id: str) -> dict:
    """
    Fetch data usage for a SIM card via REST endpoint.
    Returns usage in MB and calculates percentage of limit.
    """
    api_key = os.getenv("TELNYX_API_KEY")
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    
    data = response.json()
    usage_bytes = data.get("data", {}).get("total_usage_bytes", 0)
    usage_mb = usage_bytes / (1024 * 1024)
    
    # Calculate percentage of threshold
    percentage = (usage_mb / DATA_LIMIT_THRESHOLD_MB * 100) if DATA_LIMIT_THRESHOLD_MB > 0 else 0
    
    return {
        "sim_card_id": sim_card_id,
        "usage_mb": round(usage_mb, 2),
        "usage_bytes": usage_bytes,
        "threshold_mb": DATA_LIMIT_THRESHOLD_MB,
        "percentage_of_limit": round(percentage, 1),
        "alert_triggered": usage_mb >= DATA_LIMIT_THRESHOLD_MB,
        "timestamp": datetime.utcnow().isoformat(),
    }


def check_sim_data_health(sim_card_id: str) -> dict:
    """
    Comprehensive health check combining SIM details and data usage.
    Returns a single object with all monitoring data.
    """
    sim_details = get_sim_card_details(sim_card_id)
    usage_data = get_data_usage(sim_card_id)
    
    return {
        "sim": sim_details,
        "usage": usage_data,
        "health_status": "warning" if usage_data["alert_triggered"] else "healthy",
    }


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring infrastructure."""
    return jsonify({"status": "ok", "service": "data-usage-monitor"}), 200


@app.route("/sim-cards", methods=["GET"])
def list_sims():
    """List all SIM cards in the account."""
    try:
        sims = list_all_sim_cards()
        return jsonify({"data": sims, "count": len(sims)}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>", methods=["GET"])
def get_sim(sim_card_id: str):
    """Retrieve details for a specific SIM card."""
    try:
        sim = get_sim_card_details(sim_card_id)
        return jsonify(sim), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/usage", methods=["GET"])
def get_usage(sim_card_id: str):
    """Get data usage metrics for a specific SIM card."""
    try:
        usage = get_data_usage(sim_card_id)
        return jsonify(usage), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "Failed to fetch usage data"}), 500
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/health", methods=["GET"])
def check_health(sim_card_id: str):
    """Get comprehensive health status for a SIM card."""
    try:
        health = check_sim_data_health(sim_card_id)
        return jsonify(health), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "Failed to fetch health data"}), 500
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/activate", methods=["POST"])
def activate_sim(sim_card_id: str):
    """Activate a SIM card."""
    try:
        response = client.sim_cards.activate(sim_card_id)
        
        return jsonify({
            "id": response.data.id,
            "status": response.data.status,
            "message": "SIM card activated successfully",
        }), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIM card not found"}), 404
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/webhooks/sim-events", methods=["POST"])
def handle_sim_webhook():
    """
    Handle incoming SIM card events from Telnyx webhooks.
    Events include: sim_card.status.changed, sim_card.data_limit.reached
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    event_type = data.get("type")
    event_data = data.get("data", {})
    
    # Log the event (in production, store in database)
    print(f"[{datetime.utcnow().isoformat()}] Event: {event_type}")
    print(f"SIM Card ID: {event_data.get('id')}")
    print(f"Status: {event_data.get('status')}")
    
    # Handle specific event types
    if event_type == "sim_card.status.changed":
        sim_id = event_data.get("id")
        new_status = event_data.get("status")
        print(f"SIM {sim_id} status changed to {new_status}")
        
    elif event_type == "sim_card.data_limit.reached":
        sim_id = event_data.get("id")
        print(f"ALERT: SIM {sim_id} has reached its data limit")
    
    # Always return 200 to acknowledge receipt
    return jsonify({"status": "received"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
