#!/usr/bin/env python3
"""Flask application for managing inbound SIP routing with Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(name: str, sip_uri: str, username: str = None, password: str = None) -> dict:
    """Create a new SIP connection for inbound routing."""
    connection_params = {
        "connection_name": name,
        "transport_protocol": "UDP",
        "default_on_hold_comfort_noise_enabled": True,
        "dtmf_type": "RFC 2833",
        "encode_contact_header_enabled": False,
        "encrypted_media": "SRTP",
        "onnet_t38_passthrough_enabled": False,
        "webhook_event_url": "",
        "webhook_event_failover_url": "",
        "webhook_api_version": "1",
        "webhook_timeout_secs": 25,
        "rtcp_settings": {
            "port": "rtp+1"
        }
    }
    
    # Configure authentication method based on provided credentials
    if username and password:
        # Credential-based authentication
        connection_params.update({
            "sip_uri": sip_uri,
            "sip_username": username,
            "sip_password": password,
            "auth_username": username
        })
    else:
        # IP-based authentication (no registration required)
        connection_params.update({
            "sip_uri": sip_uri,
            "auth_username": "",
            "sip_username": "",
            "sip_password": ""
        })
    
    response = client.sip_connections.create(**connection_params)
    
    # Extract serializable data from SDK response
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "sip_uri": response.data.sip_uri,
        "username": response.data.sip_username,
        "status": "created",
        "auth_method": "credential" if username else "ip"
    }


def list_sip_connections() -> list:
    """Retrieve all SIP connections with routing information."""
    response = client.sip_connections.list()
    
    return [
        {
            "id": connection.id,
            "name": connection.connection_name,
            "sip_uri": connection.sip_uri,
            "username": connection.sip_username,
            "transport": connection.transport_protocol,
            "encrypted_media": connection.encrypted_media
        }
        for connection in response.data
    ]


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve detailed information about a specific SIP connection."""
    response = client.sip_connections.retrieve(connection_id)
    
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "sip_uri": response.data.sip_uri,
        "username": response.data.sip_username,
        "transport": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media,
        "dtmf_type": response.data.dtmf_type,
        "webhook_url": response.data.webhook_event_url,
        "rtcp_settings": response.data.rtcp_settings
    }


@app.route("/sip/connections", methods=["GET"])
def list_connections():
    """List all SIP connections configured for inbound routing."""
    try:
        connections = list_sip_connections()
        return jsonify({"connections": connections}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections", methods=["POST"])
def create_connection():
    """Create a new SIP connection for inbound call routing."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    sip_uri = data.get("sip_uri")
    username = data.get("username")
    password = data.get("password")
    
    if not name or not sip_uri:
        return jsonify({"error": "Missing required fields: 'name' and 'sip_uri'"}), 400
    
    try:
        connection = create_sip_connection(name, sip_uri, username, password)
        return jsonify(connection), 201
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections/<connection_id>", methods=["GET"])
def get_connection(connection_id):
    """Get detailed information about a specific SIP connection."""
    try:
        connection = get_sip_connection(connection_id)
        return jsonify(connection), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
