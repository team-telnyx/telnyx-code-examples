#!/usr/bin/env python3
"""Production-ready Flask endpoint for listing Telnyx AI Assistants."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def fetch_assistants() -> list[dict]:
    """Retrieve all AI Assistants and return JSON-serializable data."""
    response = client.ai_assistants.list()

    # SDK objects are NOT JSON-serializable — always unpack to plain dicts
    return [
        {
            "id": assistant.id,
            "name": assistant.name,
            "model": assistant.model,
            "instructions": assistant.instructions,
            "enabled_features": assistant.enabled_features,
            "created_at": assistant.created_at,
        }
        for assistant in response.data
    ]


@app.route("/assistants", methods=["GET"])
def list_assistants():
    """Return all AI Assistants as a JSON array."""
    try:
        assistants = fetch_assistants()
        return jsonify(assistants), 200

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
