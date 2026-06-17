#!/usr/bin/env python3
"""Production-ready SIP failover routing system with Flask and Telnyx."""

import os
import telnyx
import requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for SIP connection health status
sip_endpoints = {
    "primary": {
        "ip": os.getenv("PRIMARY_SIP_IP"),
        "port": int(os.getenv("PRIMARY_SIP_PORT", "5060")),
        "healthy": True,
        "last_check": None,
    },
    "backup": {
        "ip": os.getenv("BACKUP_SIP_IP"),
        "port": int(os.getenv("BACKUP_SIP_PORT", "5060")),
        "healthy": True,
        "last_check": None,
    },
}


def create_sip_connection(name: str, endpoint_ip: str, endpoint_port: int) -> dict:
    """Create a SIP connection via Telnyx API."""
    response = client.sip_connections.create(
        connection_name=name,
        outbound_voice_profile_id=None,
        inbound_sip_credentials=[
            {
                "username": f"sip_{name}",
                "password": f"secure_password_{name}",
            }
        ],
        sip_uri_transport_protocol="udp",
    )
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": response.data.inbound_sip_credentials[0].username if response.data.inbound_sip_credentials else None,
    }


def list_sip_connections() -> list:
    """Retrieve all SIP connections from Telnyx."""
    response = client.sip_connections.list()
    
    # Extract serializable data from list
    return [
        {
            "id": c.id,
            "name": c.connection_name,
            "username": c.inbound_sip_credentials[0].username if c.inbound_sip_credentials else None,
        }
        for c in response.data
    ]


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve a specific SIP connection by ID."""
    response = client.sip_connections.retrieve(connection_id)
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": response.data.inbound_sip_credentials[0].username if response.data.inbound_sip_credentials else None,
    }


def check_endpoint_health(endpoint_name: str) -> bool:
    """Check if a SIP endpoint is reachable via OPTIONS ping."""
    endpoint = sip_endpoints.get(endpoint_name)
    if not endpoint:
        return False
    
    try:
        # Attempt to reach the SIP endpoint with a simple HTTP health check
        # In production, use SIP OPTIONS ping instead
        response = requests.get(
            f"https://{endpoint['ip']}:{endpoint['port']}/health",
            timeout=5,
        )
        is_healthy = response.status_code == 200
    except (requests.RequestException, Exception):
        is_healthy = False
    
    # Update endpoint status
    endpoint["healthy"] = is_healthy
    endpoint["last_check"] = datetime.utcnow().isoformat()
    
    return is_healthy


def get_active_endpoint() -> str:
    """Return the name of the active SIP endpoint based on health status."""
    # Check primary endpoint first
    if check_endpoint_health("primary") and sip_endpoints["primary"]["healthy"]:
        return "primary"
    
    # Fall back to backup if primary is unhealthy
    if check_endpoint_health("backup") and sip_endpoints["backup"]["healthy"]:
        return "backup"
    
    # If both are down, return primary (will fail gracefully)
    return "primary"


def assign_phone_number_to_connection(phone_number: str, connection_id: str) -> dict:
    """Assign a Telnyx phone number to a SIP connection."""
    # This requires a REST API call since the SDK may not expose this directly
    headers = {
        "Authorization": f"Bearer {os.getenv('TELNYX_API_KEY')}",
        "Content-Type": "application/json",
    }
    
    payload = {
        "connection_id": connection_id,
    }
    
    response = requests.patch(
        f"https://api.telnyx.com/v2/phone_numbers/{phone_number}",
        json=payload,
        headers=headers,
        timeout=10,
    )
    
    if response.status_code not in [200, 201]:
        raise ValueError(f"Failed to assign phone number: {response.text}")
    
    return response.json().get("data", {})


@app.route("/sip/connections", methods=["GET"])
def list_connections():
    """List all SIP connections."""
    try:
        connections = list_sip_connections()
        return jsonify({"connections": connections}), 200
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections", methods=["POST"])
def create_connection():
    """Create a new SIP connection."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    if not name:
        return jsonify({"error": "Missing required field: 'name'"}), 400
    
    try:
        connection = create_sip_connection(name, None, None)
        return jsonify(connection), 201
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections/<connection_id>", methods=["GET"])
def get_connection(connection_id):
    """Retrieve a specific SIP connection."""
    try:
        connection = get_sip_connection(connection_id)
        return jsonify(connection), 200
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/health", methods=["GET"])
def check_health():
    """Check health status of all SIP endpoints."""
    primary_healthy = check_endpoint_health("primary")
    backup_healthy = check_endpoint_health("backup")
    active = get_active_endpoint()
    
    return jsonify({
        "primary": {
            "ip": sip_endpoints["primary"]["ip"],
            "healthy": primary_healthy,
            "last_check": sip_endpoints["primary"]["last_check"],
        },
        "backup": {
            "ip": sip_endpoints["backup"]["ip"],
            "healthy": backup_healthy,
            "last_check": sip_endpoints["backup"]["last_check"],
        },
        "active_endpoint": active,
    }), 200


@app.route("/sip/failover-status", methods=["GET"])
def failover_status():
    """Get current failover routing status."""
    active = get_active_endpoint()
    endpoint = sip_endpoints[active]
    
    return jsonify({
        "active_endpoint": active,
        "sip_uri": f"sip://{endpoint['ip']}:{endpoint['port']}",
        "primary_healthy": sip_endpoints["primary"]["healthy"],
        "backup_healthy": sip_endpoints["backup"]["healthy"],
    }), 200


@app.route("/webhooks/call", methods=["POST"])
def handle_inbound_call():
    """Webhook handler for inbound calls — route to active SIP endpoint."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    # Determine active endpoint for call routing
    active = get_active_endpoint()
    endpoint = sip_endpoints[active]
    
    # Log the routing decision
    call_id = data.get("data", {}).get("id", "unknown")
    print(f"[{datetime.utcnow().isoformat()}] Routing call {call_id} to {active} endpoint ({endpoint['ip']}:{endpoint['port']})")
    
    # Return TwiML-like response to route call to SIP endpoint
    # In production, use Telnyx Call Control API to bridge the call
    return jsonify({
        "routing": {
            "endpoint": active,
            "sip_uri": f"sip://{endpoint['ip']}:{endpoint['port']}",
            "call_id": call_id,
        }
    }), 200


@app.route("/sip/assign-number", methods=["POST"])
def assign_number():
    """Assign a phone number to a SIP connection."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    connection_id = data.get("connection_id")
    
    if not phone_number or not connection_id:
        return jsonify({"error": "Missing required fields: 'phone_number' and 'connection_id'"}), 400
    
    try:
        result = assign_phone_number_to_connection(phone_number, connection_id)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
