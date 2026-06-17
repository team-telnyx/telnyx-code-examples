#!/usr/bin/env python3
"""Production-ready Flask application for SIP codec configuration via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection_with_codecs(
    name: str,
    codecs: list,
    username: str = None,
    password: str = None,
    sip_endpoint: str = None,
) -> dict:
    """
    Create a SIP connection with specified codec preferences.
    
    Args:
        name: Friendly name for the SIP connection.
        codecs: List of codec names in priority order (e.g., ["G.711", "G.729"]).
        username: SIP username for credential authentication.
        password: SIP password for credential authentication.
        sip_endpoint: SIP endpoint address (e.g., sip.example.com:5060).
    
    Returns:
        Dictionary with connection details and codec configuration.
    """
    if not username:
        username = os.getenv("SIP_USERNAME")
    if not password:
        password = os.getenv("SIP_PASSWORD")
    if not sip_endpoint:
        sip_endpoint = os.getenv("SIP_ENDPOINT")
    
    if not all([username, password, sip_endpoint]):
        raise ValueError("SIP credentials and endpoint are required")
    
    # Map codec names to Telnyx codec identifiers
    codec_map = {
        "G.711": "PCMU",
        "G.729": "G729",
        "Opus": "OPUS",
        "PCMU": "PCMU",
        "PCMA": "PCMA",
    }
    
    # Validate and normalize codec list
    normalized_codecs = []
    for codec in codecs:
        if codec not in codec_map:
            raise ValueError(f"Unsupported codec: {codec}. Supported: {list(codec_map.keys())}")
        normalized_codecs.append(codec_map[codec])
    
    # Create SIP connection with codec preferences
    response = client.sip_connections.create(
        connection_name=name,
        outbound_voice_profile_id=None,
        inbound_sip_credentials=[
            {
                "username": username,
                "password": password,
            }
        ],
        inbound_addresses=[sip_endpoint],
        codec_configurations=[
            {
                "codec": codec,
                "priority": idx,
            }
            for idx, codec in enumerate(normalized_codecs)
        ],
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "username": username,
        "sip_endpoint": sip_endpoint,
        "codecs": normalized_codecs,
        "created_at": str(response.data.created_at) if hasattr(response.data, "created_at") else None,
    }


def get_sip_connection_codecs(connection_id: str) -> dict:
    """
    Retrieve codec configuration for an existing SIP connection.
    
    Args:
        connection_id: The ID of the SIP connection.
    
    Returns:
        Dictionary with connection details and current codec settings.
    """
    response = client.sip_connections.retrieve(connection_id)
    
    # Extract codec configuration from the response
    codecs = []
    if hasattr(response.data, "codec_configurations") and response.data.codec_configurations:
        codecs = [
            {
                "codec": c.get("codec") if isinstance(c, dict) else getattr(c, "codec", None),
                "priority": c.get("priority") if isinstance(c, dict) else getattr(c, "priority", None),
            }
            for c in response.data.codec_configurations
        ]
    
    return {
        "id": response.data.id,
        "name": response.data.connection_name,
        "codecs": codecs,
        "inbound_addresses": response.data.inbound_addresses if hasattr(response.data, "inbound_addresses") else [],
    }


def list_sip_connections() -> list:
    """
    List all SIP connections with their codec configurations.
    
    Returns:
        List of dictionaries containing connection details.
    """
    response = client.sip_connections.list()
    
    connections = []
    for conn in response.data:
        codecs = []
        if hasattr(conn, "codec_configurations") and conn.codec_configurations:
            codecs = [
                {
                    "codec": c.get("codec") if isinstance(c, dict) else getattr(c, "codec", None),
                    "priority": c.get("priority") if isinstance(c, dict) else getattr(c, "priority", None),
                }
                for c in conn.codec_configurations
            ]
        
        connections.append({
            "id": conn.id,
            "name": conn.connection_name,
            "codecs": codecs,
        })
    
    return connections


@app.route("/sip/connections", methods=["GET"])
def list_connections():
    """HTTP endpoint to list all SIP connections."""
    try:
        connections = list_sip_connections()
        return jsonify(connections), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections", methods=["POST"])
def create_connection():
    """HTTP endpoint to create a new SIP connection with codec configuration."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    codecs = data.get("codecs", ["G.711"])
    username = data.get("username")
    password = data.get("password")
    sip_endpoint = data.get("sip_endpoint")
    
    if not name:
        return jsonify({"error": "Missing required field: 'name'"}), 400
    
    try:
        result = create_sip_connection_with_codecs(
            name=name,
            codecs=codecs,
            username=username,
            password=password,
            sip_endpoint=sip_endpoint,
        )
        return jsonify(result), 201
        
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


@app.route("/sip/connections/<connection_id>", methods=["GET"])
def get_connection(connection_id):
    """HTTP endpoint to retrieve codec configuration for a specific SIP connection."""
    try:
        result = get_sip_connection_codecs(connection_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
