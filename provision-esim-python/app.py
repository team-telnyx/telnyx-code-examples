#!/usr/bin/env python3
"""Production-ready Flask application for eSIM provisioning via Telnyx."""

import os
import telnyx
from flask import Flask, jsonify, request, current_app
from dotenv import load_dotenv

load_dotenv()


# ============================================================================
# Application Factory
# ============================================================================

def create_app():
    """Factory function to create and configure Flask app."""
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False
    
    # Initialize Telnyx client with the new SDK pattern
    app.telnyx_client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
    
    return app


app = create_app()


# ============================================================================
# eSIM Provisioning Models
# ============================================================================

def create_esim_profile(client, device_name: str, sim_card_group_id: str) -> dict:
    """Create an eSIM profile for a device."""
    response = client.sim_cards.create(
        sim_card_group_id=sim_card_group_id,
        tags=[device_name],
    )
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "created_at": str(response.data.created_at) if hasattr(response.data, "created_at") else None,
    }


def activate_esim_profile(client, sim_card_id: str) -> dict:
    """Activate an eSIM profile for network connectivity."""
    response = client.sim_cards.activate(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }


def get_esim_profile(client, sim_card_id: str) -> dict:
    """Retrieve details of an eSIM profile."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
        "tags": response.data.tags if hasattr(response.data, "tags") else [],
    }


def list_esim_profiles(client, sim_card_group_id: str = None, limit: int = 20) -> list:
    """List eSIM profiles, optionally filtered by SIM card group."""
    params = {"limit": limit}
    if sim_card_group_id:
        params["filter[sim_card_group_id]"] = sim_card_group_id
    
    response = client.sim_cards.list(**params)
    
    return [
        {
            "id": s.id,
            "iccid": s.iccid,
            "status": s.status,
            "sim_card_group_id": s.sim_card_group_id,
            "tags": s.tags if hasattr(s, "tags") else [],
        }
        for s in response.data
    ]


# ============================================================================
# Flask Routes
# ============================================================================

@app.route("/esim/profiles", methods=["POST"])
def provision_esim():
    """Provision a new eSIM profile."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    device_name = data.get("device_name")
    sim_card_group_id = data.get("sim_card_group_id")
    
    if not device_name or not sim_card_group_id:
        return jsonify({
            "error": "Missing required fields: 'device_name' and 'sim_card_group_id'"
        }), 400
    
    try:
        client = current_app.telnyx_client
        profile = create_esim_profile(client, device_name, sim_card_group_id)
        return jsonify(profile), 201
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/esim/profiles/<sim_card_id>/activate", methods=["POST"])
def activate_esim(sim_card_id: str):
    """Activate an eSIM profile for network connectivity."""
    if not sim_card_id:
        return jsonify({"error": "sim_card_id is required"}), 400
    
    try:
        client = current_app.telnyx_client
        profile = activate_esim_profile(client, sim_card_id)
        return jsonify(profile), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/esim/profiles/<sim_card_id>", methods=["GET"])
def get_esim(sim_card_id: str):
    """Retrieve details of an eSIM profile."""
    if not sim_card_id:
        return jsonify({"error": "sim_card_id is required"}), 400
    
    try:
        client = current_app.telnyx_client
        profile = get_esim_profile(client, sim_card_id)
        return jsonify(profile), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/esim/profiles", methods=["GET"])
def list_esims():
    """List eSIM profiles with optional filtering."""
    sim_card_group_id = request.args.get("sim_card_group_id")
    limit = request.args.get("limit", default=20, type=int)
    
    if limit < 1 or limit > 100:
        return jsonify({"error": "limit must be between 1 and 100"}), 400
    
    try:
        client = current_app.telnyx_client
        profiles = list_esim_profiles(client, sim_card_group_id, limit)
        return jsonify(profiles), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/esim/webhooks/sim-status", methods=["POST"])
def handle_sim_status_webhook():
    """Handle SIM card status change webhooks from Telnyx."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Webhook payload required"}), 400
    
    event_type = data.get("event_type")
    sim_card_id = data.get("data", {}).get("id")
    status = data.get("data", {}).get("status")
    
    # Log webhook event (in production, store in database)
    print(f"[WEBHOOK] Event: {event_type}, SIM: {sim_card_id}, Status: {status}")
    
    return jsonify({"received": True}), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
