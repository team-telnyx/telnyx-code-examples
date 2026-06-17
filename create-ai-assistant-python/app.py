#!/usr/bin/env python3
"""Production-ready Flask endpoint for creating AI assistants via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_ai_assistant(name: str, instructions: str, model: str = "meta-llama/Meta-Llama-3.1-70B-Instruct", enabled_features: list = None) -> dict:
    """Create AI assistant via Telnyx and return JSON-serializable response data."""
    if not name or not instructions:
        raise ValueError("Name and instructions are required")
    
    # Default to messaging if no features specified
    if enabled_features is None:
        enabled_features = ["messaging"]
    
    # Validate enabled features
    valid_features = ["messaging", "telephony"]
    for feature in enabled_features:
        if feature not in valid_features:
            raise ValueError(f"Invalid feature: {feature}. Must be one of: {valid_features}")
    
    # Use client.ai_assistants.create() — NOT client.ai_assistants.create()
    response = client.ai_assistants.create(
        name=name,
        instructions=instructions,
        model=model,
        enabled_features=enabled_features,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "enabled_features": response.data.enabled_features,
        "created_at": response.data.created_at,
    }


@app.route("/ai/assistants", methods=["POST"])
def create_assistant_endpoint():
    """HTTP endpoint to create AI assistant."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    instructions = data.get("instructions")
    model = data.get("model", "meta-llama/Meta-Llama-3.1-70B-Instruct")
    enabled_features = data.get("enabled_features", ["messaging"])
    
    if not name or not instructions:
        return jsonify({"error": "Missing required fields: 'name' and 'instructions'"}), 400
    
    try:
        result = create_ai_assistant(name, instructions, model, enabled_features)
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
