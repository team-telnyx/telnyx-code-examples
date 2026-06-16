#!/usr/bin/env python3
"""Production-ready Flask application for SIM card activation via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def list_sim_cards() -> list:
    """Retrieve all SIM cards and return JSON-serializable list."""
    response = client.sim_cards.list()
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return [
        {
            "id": sim.id,
            "iccid": sim.iccid,
            "status": sim.status,
            "sim_card_group_id": sim.sim_card_group_id,
        }
        for sim in response.data
    ]


def get_sim_card(sim_card_id: str) -> dict:
    """Retrieve a single SIM card by ID and return JSON-serializable data."""
    response = client.sim_cards.retrieve(sim_card_id)
    
    # Extract serializable data from the response object
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }


def activate_sim_card(sim_card_id: str) -> dict:
    """Activate a SIM card and return JSON-serializable response data."""
    if not sim_card_id:
        raise ValueError("SIM card ID is required")
    
    # Call the activate method with the SIM card ID
    response = client.sim_cards.activate(sim_card_id)
    
    # Extract serializable data from the response object
    return {
        "id": response.data.id,
        "iccid": response.data.iccid,
        "status": response.data.status,
        "sim_card_group_id": response.data.sim_card_group_id,
    }


@app.route("/sim-cards", methods=["GET"])
def list_sims():
    """HTTP endpoint to list all SIM cards."""
    try:
        sims = list_sim_cards()
        return jsonify({"data": sims}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>", methods=["GET"])
def get_sim(sim_card_id):
    """HTTP endpoint to retrieve a single SIM card."""
    try:
        sim = get_sim_card(sim_card_id)
        return jsonify(sim), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sim-cards/<sim_card_id>/activate", methods=["POST"])
def activate_sim(sim_card_id):
    """HTTP endpoint to activate a SIM card."""
    try:
        result = activate_sim_card(sim_card_id)
        return jsonify({"message": "SIM card activated successfully", "data": result}), 200
        
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
