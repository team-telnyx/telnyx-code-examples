#!/usr/bin/env python3
"""Flask application for IoT SIM management with MQTT messaging."""

import os
import json
import telnyx
import requests
from datetime import datetime
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# MQTT configuration
MQTT_BROKER = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")


def get_mqtt_client():
    """Initialize and configure MQTT client."""
    mqtt_client = mqtt.Client()
    
    if MQTT_USERNAME and MQTT_PASSWORD:
        mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        return mqtt_client
    except Exception as e:
        raise ConnectionError(f"Failed to connect to MQTT broker: {str(e)}")


def get_sim_cards() -> list:
    """Retrieve all SIM cards and return JSON-serializable data."""
    response = client.sim_cards.list()
    
    return [
        {
            "id": sim.id,
            "iccid": sim.iccid,
            "status": sim.status,
            "sim_card_group_id": sim.sim_card_group_id,
            "tags": getattr(sim, 'tags', []),
        }
        for sim in response.data
    ]


def get_sim_data_usage(sim_card_id: str) -> dict:
    """Get data usage for a specific SIM card via REST API."""
    api_key = os.getenv("TELNYX_API_KEY")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    url = f"https://api.telnyx.com/v2/sim_cards/{sim_card_id}/network_usage"
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        return {
            "sim_card_id": sim_card_id,
            "data_usage_mb": data.get("data", {}).get("total_mb", 0),
            "last_updated": datetime.utcnow().isoformat(),
        }
    else:
        raise ValueError(f"Failed to fetch data usage: {response.status_code}")


def publish_sim_status(sim_data: dict, mqtt_client) -> bool:
    """Publish SIM card status to MQTT topic."""
    topic = f"telnyx/iot/sim/{sim_data['iccid']}/status"
    payload = json.dumps({
        "sim_id": sim_data["id"],
        "iccid": sim_data["iccid"],
        "status": sim_data["status"],
        "timestamp": datetime.utcnow().isoformat(),
    })
    
    result = mqtt_client.publish(topic, payload, qos=1)
    return result.rc == mqtt.MQTT_ERR_SUCCESS


@app.route("/sims", methods=["GET"])
def list_sims():
    """List all SIM cards."""
    try:
        sims = get_sim_cards()
        return jsonify({"sims": sims, "count": len(sims)}), 200
    except Exception:
        raise


@app.route("/sims/<sim_card_id>/usage", methods=["GET"])
def get_usage(sim_card_id):
    """Get data usage for a specific SIM card."""
    try:
        usage_data = get_sim_data_usage(sim_card_id)
        return jsonify(usage_data), 200
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400
    except Exception:
        raise


@app.route("/sims/<sim_card_id>/publish", methods=["POST"])
def publish_sim_data(sim_card_id):
    """Publish SIM card data to MQTT broker."""
    try:
        response = client.sim_cards.retrieve(sim_card_id)
        sim_data = {
            "id": response.data.id,
            "iccid": response.data.iccid,
            "status": response.data.status,
            "sim_card_group_id": response.data.sim_card_group_id,
        }
        
        mqtt_client = get_mqtt_client()
        success = publish_sim_status(sim_data, mqtt_client)
        mqtt_client.disconnect()
        
        if success:
            return jsonify({
                "message": "SIM data published successfully",
                "topic": f"telnyx/iot/sim/{sim_data['iccid']}/status",
                "sim_id": sim_card_id
            }), 200
        else:
            return jsonify({"error": "Failed to publish to MQTT"}), 500
            
    except ConnectionError as e:
        return jsonify({"error": str(e)}), 503
    except Exception:
        raise


@app.route("/sims/publish-all", methods=["POST"])
def publish_all_sims():
    """Publish status for all active SIM cards to MQTT."""
    try:
        sims = get_sim_cards()
        mqtt_client = get_mqtt_client()
        
        published_count = 0
        for sim in sims:
            if sim["status"] == "active":
                success = publish_sim_status(sim, mqtt_client)
                if success:
                    published_count += 1
        
        mqtt_client.disconnect()
        
        return jsonify({
            "message": f"Published {published_count} SIM cards to MQTT",
            "total_active": len([s for s in sims if s["status"] == "active"])
        }), 200
        
    except ConnectionError as e:
        return jsonify({"error": str(e)}), 503
    except Exception:
        raise


@app.errorhandler(Exception)
def handle_error(e):
    """Global error handler for Telnyx API exceptions."""
    if isinstance(e, telnyx.AuthenticationError):
        return jsonify({"error": "Invalid API key"}), 401
    if isinstance(e, telnyx.RateLimitError):
        return jsonify({"error": "Rate limit exceeded"}), 429
    if isinstance(e, telnyx.APIStatusError):
        return jsonify({"error": "API request failed"}), e.status_code
    if isinstance(e, telnyx.APIConnectionError):
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
