#!/usr/bin/env python3
"""Production-ready Flask application for SIP registration with Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request, render_template_string

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_sip_connection(connection_name: str, username: str, password: str) -> dict:
    """Create a new SIP connection with credential authentication."""
    if not connection_name or not username or not password:
        raise ValueError("Connection name, username, and password are required")
    
    # Create SIP connection with credential authentication
    response = client.sip_connections.create(
        connection_name=connection_name,
        user_name=username,
        password=password,
        # Enable credential authentication (username/password)
        sip_uri_calling_preference="telnyx",
        # Configure for standard SIP registration
        transport_protocol="UDP",
        default_on_hold_comfort_noise_enabled=True,
        dtmf_type="RFC 2833",
        encode_contact_header_enabled=False,
        encrypted_media="SRTP",
        onnet_t38_passthrough_enabled=False,
        webhook_event_url="",
        webhook_event_failover_url="",
        webhook_api_version="1",
        webhook_timeout_secs=25,
        rtcp_settings={
            "port": "rtp+1",
            "capture_enabled": False,
            "report_frequency_secs": 5
        }
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "connection_name": response.data.connection_name,
        "user_name": response.data.user_name,
        "sip_uri": f"sip:{response.data.user_name}@{os.getenv('SIP_DOMAIN')}",
        "status": "created",
        "transport_protocol": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media
    }


def get_sip_connection(connection_id: str) -> dict:
    """Retrieve SIP connection details by ID."""
    response = client.sip_connections.retrieve(connection_id)
    
    return {
        "id": response.data.id,
        "connection_name": response.data.connection_name,
        "user_name": response.data.user_name,
        "sip_uri": f"sip:{response.data.user_name}@{os.getenv('SIP_DOMAIN')}",
        "transport_protocol": response.data.transport_protocol,
        "encrypted_media": response.data.encrypted_media,
        "created_at": response.data.created_at,
        "updated_at": response.data.updated_at
    }


def list_sip_connections() -> list:
    """List all SIP connections for the account."""
    response = client.sip_connections.list()
    
    return [
        {
            "id": c.id,
            "connection_name": c.connection_name,
            "user_name": c.user_name,
            "sip_uri": f"sip:{c.user_name}@{os.getenv('SIP_DOMAIN')}",
            "transport_protocol": c.transport_protocol,
            "created_at": c.created_at
        }
        for c in response.data
    ]


@app.route("/sip/connections", methods=["POST"])
def create_connection():
    """Create a new SIP connection for registration."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    connection_name = data.get("connection_name")
    username = data.get("username")
    password = data.get("password")
    
    if not all([connection_name, username, password]):
        return jsonify({
            "error": "Missing required fields: 'connection_name', 'username', 'password'"
        }), 400
    
    try:
        result = create_sip_connection(connection_name, username, password)
        return jsonify(result), 201
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/sip/connections/<connection_id>", methods=["GET"])
def get_connection(connection_id):
    """Retrieve SIP connection details."""
    try:
        result = get_sip_connection(connection_id)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        if e.status_code == 404:
            return jsonify({"error": "SIP connection not found"}), 404
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/sip/connections", methods=["GET"])
def list_connections():
    """List all SIP connections."""
    try:
        result = list_sip_connections()
        return jsonify({"connections": result}), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed"}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503


@app.route("/")
def dashboard():
    """Simple dashboard showing SIP registration instructions."""
    html = """
    <!DOCTYPE html>
    <html>
    <head><title>Telnyx SIP Registration</title></head>
    <body>
        <h1>SIP Registration Dashboard</h1>
        <h2>Create SIP Connection</h2>
        <p>POST /sip/connections with JSON body:</p>
        <pre>{"connection_name": "My PBX", "username": "user123", "password": "secure_pass"}</pre>
        
        <h2>Configure Your SIP Client</h2>
        <ul>
            <li><strong>SIP Server:</strong> sip.telnyx.com</li>
            <li><strong>Transport:</strong> UDP (default port 5060)</li>
            <li><strong>Username:</strong> From your connection response</li>
            <li><strong>Password:</strong> From your connection creation</li>
            <li><strong>Registration:</strong> Required for inbound calls</li>
        </ul>
        
        <h2>API Endpoints</h2>
        <ul>
            <li>GET /sip/connections - List all connections</li>
            <li>POST /sip/connections - Create new connection</li>
            <li>GET /sip/connections/{id} - Get connection details</li>
        </ul>
    </body>
    </html>
    """
    return render_template_string(html)


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
