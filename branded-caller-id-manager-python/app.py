#!/usr/bin/env python3
"""Branded Caller ID Manager — register, manage, and verify branded calling profiles with STIR/SHAKEN attestation for higher answer rates."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
campaigns = []

@app.route("/brands", methods=["POST"])
def create_brand():
    data = request.get_json()
    try:
        # nosemgrep: python.django.security.injection.ssrf.ssrf-injection-requests -- URL is the constant Telnyx API base; only the JSON body is request-derived.
        resp = requests.post(f"{API}/brand", headers=headers,
            json={"entity_type": data.get("entity_type", "PRIVATE_PROFIT"),
                "display_name": data.get("display_name"),
                "company_name": data.get("company_name"),
                "ein": data.get("ein"), "phone": data.get("phone"),
                "street": data.get("street"), "city": data.get("city"),
                "state": data.get("state"), "postal_code": data.get("postal_code"),
                "country": data.get("country", "US"),
                "vertical": data.get("vertical", "TECHNOLOGY"),
                "website": data.get("website")}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create brand")
        return jsonify({"error": "could not create brand"}), 500

@app.route("/brands", methods=["GET"])
def list_brands():
    try:
        resp = requests.get(f"{API}/brand", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list brands")
        return jsonify({"error": "could not list brands"}), 500

@app.route("/campaigns", methods=["POST"])
def create_campaign():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/phoneNumberCampaign", headers=headers,
            json={"telnyx_brand_id": data.get("brand_id"),
                "usecase": data.get("usecase", "MIXED"),
                "description": data.get("description"),
                "sample_message": data.get("sample_message", ["Your appointment is tomorrow at 2pm. Reply CONFIRM."]),
                "phone_numbers": data.get("phone_numbers", [])})
        result = resp.json()
        campaigns.append(result)
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create campaign")
        return jsonify({"error": "could not create campaign"}), 500

@app.route("/numbers/<number>/caller-id", methods=["PUT"])
def update_caller_id(number):
    data = request.get_json()
    try:
        resp = requests.patch(f"{API}/phone_numbers/{number}",
            headers=headers,
            json={"caller_id_name_enabled": True,
                "cnam_listing_enabled": True,
                "cnam_listing_details": data.get("business_name", "")}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to update caller ID")
        return jsonify({"error": "could not update caller id"}), 500

@app.route("/stir-shaken/status", methods=["GET"])
def stir_shaken_status():
    number = request.args.get("number")
    try:
        resp = requests.get(f"{API}/phone_numbers/{number}",
            headers=headers, timeout=15)
        data = resp.json().get("data", {})
        return jsonify({"number": number,
            "cnam_enabled": data.get("cnam_listing_enabled"),
            "caller_id_name": data.get("cnam_listing_details"),
            "purchased_at": data.get("purchased_at")}), 200
    except Exception as e:
        app.logger.exception("Failed to fetch STIR/SHAKEN status")
        return jsonify({"error": "could not fetch stir/shaken status"}), 500

@app.route("/campaigns", methods=["GET"])
def list_campaigns():
    return jsonify({"campaigns": campaigns}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "campaigns": len(campaigns)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
