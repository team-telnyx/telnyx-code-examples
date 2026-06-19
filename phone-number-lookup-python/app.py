#!/usr/bin/env python3
"""Production-ready Flask application for phone number lookup via Telnyx."""

import os
import telnyx
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Simple in-memory cache for lookup results
lookup_cache = {}
CACHE_TTL = timedelta(hours=24)


def is_cache_valid(cached_entry: dict) -> bool:
    """Check if a cached entry is still valid based on TTL."""
    if not cached_entry:
        return False
    cached_time = cached_entry.get("cached_at")
    if not cached_time:
        return False
    return datetime.utcnow() - cached_time < CACHE_TTL


def get_cached_lookup(phone_number: str) -> dict:
    """Retrieve a lookup result from cache if valid."""
    if phone_number in lookup_cache:
        entry = lookup_cache[phone_number]
        if is_cache_valid(entry):
            return entry.get("data")
    return None


def cache_lookup_result(phone_number: str, result: dict) -> None:
    """Store a lookup result in cache with timestamp."""
    lookup_cache[phone_number] = {
        "data": result,
        "cached_at": datetime.utcnow(),
    }


def lookup_phone_number(phone_number: str) -> dict:
    """
    Perform a number lookup via Telnyx API.
    Returns JSON-serializable lookup data including carrier and line type.
    """
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Check cache first
    cached_result = get_cached_lookup(phone_number)
    if cached_result:
        cached_result["from_cache"] = True
        return cached_result
    
    # Call Telnyx Number Lookup API
    response = client.number_lookup.retrieve(phone_number)
    
    # Extract serializable data from SDK response
    lookup_data = {
        "phone_number": response.data.phone_number,
        "country_code": response.data.country_code,
        "carrier": {
            "name": response.data.carrier.name if response.data.carrier else None,
            "type": response.data.carrier.type if response.data.carrier else None,
        },
        "line_type": response.data.line_type,
        "number_type": response.data.number_type,
        "portability": {
            "status": response.data.portability.status if response.data.portability else None,
            "last_checked_at": response.data.portability.last_checked_at if response.data.portability else None,
        },
        "from_cache": False,
    }
    
    # Cache the result
    cache_lookup_result(phone_number, lookup_data)
    
    return lookup_data


@app.route("/lookup", methods=["POST"])
def lookup_endpoint():
    """HTTP endpoint to perform number lookup."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    try:
        result = lookup_phone_number(phone_number)
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


@app.route("/lookup/<phone_number>", methods=["GET"])
def lookup_get_endpoint(phone_number: str):
    """HTTP GET endpoint to perform number lookup via URL parameter."""
    if not phone_number:
        return jsonify({"error": "Phone number required in URL path"}), 400
    
    try:
        result = lookup_phone_number(phone_number)
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


@app.route("/cache/stats", methods=["GET"])
def cache_stats_endpoint():
    """Return cache statistics for monitoring."""
    return jsonify({
        "cache_size": len(lookup_cache),
        "cached_numbers": list(lookup_cache.keys()),
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
