#!/usr/bin/env python3
"""E911 Address Validator — validate and provision E911 addresses via API."""
import os, json, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
validated_addresses = []

@app.route("/e911/validate", methods=["POST"])
def validate_address():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    address = {"street_address": data.get("street"), "extended_address": data.get("street2", ""),
        "locality": data.get("city"), "administrative_area": data.get("state"), "postal_code": data.get("zip"), "country_code": data.get("country", "US")}
    try:
        resp = requests.post("https://api.telnyx.com/v2/addresses", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={**address, "address_book": True, "business_name": data.get("business_name", "")}, timeout=15)
        if resp.ok:
            result = resp.json().get("data", {})
            validated_addresses.append(result)
            return jsonify({"valid": True, "address_id": result.get("id"), "address": result}), 200
        return jsonify({"valid": False, "error": resp.text}), 400
    except Exception as e:
        app.logger.exception("address validation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/e911/assign", methods=["POST"])
def assign_e911():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    address_id = data.get("address_id")
    try:
        resp = requests.patch(f"https://api.telnyx.com/v2/phone_numbers/{phone}", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"emergency_address_id": address_id, "emergency_enabled": True}, timeout=15)
        if resp.ok:
            return jsonify({"status": "assigned", "phone": phone, "address_id": address_id}), 200
        return jsonify({"error": resp.text}), resp.status_code
    except Exception as e:
        app.logger.exception("e911 assignment failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/e911/addresses", methods=["GET"])
def list_addresses():
    return jsonify({"addresses": validated_addresses}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "addresses": len(validated_addresses)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
