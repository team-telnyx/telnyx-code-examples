#!/usr/bin/env python3
"""Production-ready Flask application for cloning AI Assistants via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_assistant_details(assistant_id: str) -> dict:
    """Retrieve full details of an assistant for inspection before cloning."""
    response = client.ai_assistants.retrieve(assistant_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "tools": response.data.tools if hasattr(response.data, "tools") else [],
        "enabled_features": response.data.enabled_features if hasattr(response.data, "enabled_features") else [],
        "created_at": response.data.created_at,
    }


def clone_assistant(source_assistant_id: str, new_name: str = None, new_instructions: str = None) -> dict:
    """Clone an existing assistant with optional parameter overrides."""
    if not source_assistant_id:
        raise ValueError("source_assistant_id is required")
    
    # Retrieve source assistant to validate it exists
    source = client.ai_assistants.retrieve(source_assistant_id)
    
    # Use provided overrides or fall back to source values
    clone_name = new_name if new_name else f"{source.data.name} (Clone)"
    clone_instructions = new_instructions if new_instructions else source.data.instructions
    
    # Build clone parameters — include tools and features from source
    clone_params = {
        "name": clone_name,
        "model": source.data.model,
        "instructions": clone_instructions,
    }
    
    # Preserve tools if they exist on the source
    if hasattr(source.data, "tools") and source.data.tools:
        clone_params["tools"] = source.data.tools
    
    # Preserve enabled features if they exist on the source
    if hasattr(source.data, "enabled_features") and source.data.enabled_features:
        clone_params["enabled_features"] = source.data.enabled_features
    
    # Create the cloned assistant
    response = client.ai_assistants.create(**clone_params)
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "tools": response.data.tools if hasattr(response.data, "tools") else [],
        "enabled_features": response.data.enabled_features if hasattr(response.data, "enabled_features") else [],
        "created_at": response.data.created_at,
        "source_assistant_id": source_assistant_id,
    }


@app.route("/assistants/<assistant_id>", methods=["GET"])
def get_assistant(assistant_id: str):
    """Retrieve details of an assistant before cloning."""
    if not assistant_id:
        return jsonify({"error": "assistant_id is required"}), 400
    
    try:
        result = get_assistant_details(assistant_id)
        return jsonify(result), 200
        
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


@app.route("/assistants/<assistant_id>/clone", methods=["POST"])
def clone_assistant_endpoint(assistant_id: str):
    """Clone an existing assistant with optional parameter overrides."""
    if not assistant_id:
        return jsonify({"error": "assistant_id is required"}), 400
    
    data = request.get_json() or {}
    
    # Extract optional override parameters from request body
    new_name = data.get("name")
    new_instructions = data.get("instructions")
    
    try:
        result = clone_assistant(
            source_assistant_id=assistant_id,
            new_name=new_name,
            new_instructions=new_instructions,
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
