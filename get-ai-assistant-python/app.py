#!/usr/bin/env python3
"""Production-ready Flask endpoint for retrieving AI assistants via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_assistant(assistant_id: str) -> dict:
    """Retrieve AI assistant by ID and return JSON-serializable response data."""
    if not assistant_id or not assistant_id.strip():
        raise ValueError("Assistant ID is required")
    
    # Use client.ai_assistants.retrieve() — NOT client.ai_assistants.retrieve()
    response = client.ai_assistants.retrieve(assistant_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "tools": response.data.tools,
        "enabled_features": response.data.enabled_features,
        "created_at": response.data.created_at,
    }


@app.route("/assistants/<assistant_id>", methods=["GET"])
def get_assistant_endpoint(assistant_id: str):
    """HTTP endpoint to retrieve AI assistant details."""
    try:
        result = get_assistant(assistant_id)
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
