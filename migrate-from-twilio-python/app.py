#!/usr/bin/env python3
"""Migrate from Twilio — complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TELNYX_API = "https://api.telnyx.com/v2"
TWILIO_API = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}"
telnyx_headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
migration_log = []

@app.route("/audit/twilio", methods=["GET"])
def audit_twilio():
    if not TWILIO_SID:
        return jsonify({"error": "TWILIO_ACCOUNT_SID not configured"}), 400
    audit = {"numbers": [], "messaging_services": [], "applications": []}
    try:
        resp = requests.get(f"{TWILIO_API}/IncomingPhoneNumbers.json",
            auth=(TWILIO_SID, TWILIO_TOKEN), timeout=15)
        if resp.ok:
            for num in resp.json().get("incoming_phone_numbers", []):
                audit["numbers"].append({"number": num.get("phone_number"),
                    "friendly_name": num.get("friendly_name"),
                    "voice_url": num.get("voice_url"),
                    "sms_url": num.get("sms_url"),
                    "capabilities": num.get("capabilities")})
    except Exception as e:
        app.logger.exception("Failed to fetch Twilio incoming phone numbers")
        audit["numbers_error"] = "could not retrieve Twilio numbers"
    try:
        resp = requests.get(f"{TWILIO_API}/Messaging/Services.json",
            auth=(TWILIO_SID, TWILIO_TOKEN), timeout=15)
        if resp.ok:
            for svc in resp.json().get("services", []):
                audit["messaging_services"].append({"sid": svc.get("sid"),
                    "friendly_name": svc.get("friendly_name"),
                    "inbound_url": svc.get("inbound_request_url")})
    except Exception:
        pass
    migration_log.append({"action": "audit", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "numbers": len(audit["numbers"])})
    return jsonify(audit), 200

@app.route("/migrate/messaging-profile", methods=["POST"])
def migrate_messaging():
    data = request.get_json()
    try:
        resp = requests.post(f"{TELNYX_API}/messaging_profiles", headers=telnyx_headers,
            json={"name": data.get("name", "Migrated from Twilio"),
                "webhook_url": data.get("webhook_url", ""),
                "webhook_api_version": "2",
                "whitelisted_destinations": data.get("whitelisted_destinations", ["US"])}, timeout=15)
        result = resp.json()
        migration_log.append({"action": "create_messaging_profile",
            "profile_id": result.get("data", {}).get("id"),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create Telnyx messaging profile")
        return jsonify({"error": "could not create messaging profile"}), 500

@app.route("/migrate/numbers", methods=["POST"])
def migrate_numbers():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    numbers = data.get("numbers", [])
    results = []
    for num in numbers:
        try:
            resp = requests.post(f"{TELNYX_API}/porting_orders", headers=telnyx_headers,
                json={"phone_numbers": [num], "authorized_person": data.get("authorized_person"),
                    "current_provider": "Twilio",
                    "customer_reference": f"twilio-migration-{int(time.time())}"}, timeout=15)
            results.append({"number": num, "status": "port_submitted", "order": resp.json()})
        except Exception as e:
            app.logger.exception("Failed to submit porting order for %s", num)
            results.append({"number": num, "status": "failed", "error": "could not submit porting order"})
    migration_log.append({"action": "port_numbers", "count": len(numbers),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
    return jsonify({"results": results}), 200

@app.route("/migrate/webhook-map", methods=["POST"])
def map_webhooks():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    twilio_url = data.get("twilio_webhook_url", "")
    mapping = {"twilio_url": twilio_url,
        "telnyx_equivalents": {
            "voice_webhook": "Set in Call Control Application or TeXML Application",
            "sms_webhook": "Set in Messaging Profile webhook_url",
            "status_callback": "Telnyx sends webhooks for all status changes automatically",
            "fallback_url": "Set webhook_failover_url in your application config"},
        "key_differences": [
            "Telnyx uses event_type field instead of separate endpoints",
            "Call control uses call_control_id instead of CallSid",
            "Message webhooks include full payload in data field",
            "Telnyx webhooks are POST-only (no GET fallback)"]}
    return jsonify(mapping), 200

@app.route("/migrate/code-changes", methods=["GET"])
def code_changes_guide():
    return jsonify({"guide": {
        "sdk": "pip install telnyx (replaces twilio package)",
        "auth": "Bearer token header (replaces Account SID + Auth Token basic auth)",
        "voice": {"twilio": "VoiceResponse().say('Hello')", "telnyx": "call.actions.speak(payload='Hello')"},
        "sms": {"twilio": "client.messages.create(to=..., from_=..., body=...)",
            "telnyx": "requests.post('/v2/messages', json={'to': ..., 'from': ..., 'text': ...})"},
        "numbers": {"twilio": "client.incoming_phone_numbers.list()",
            "telnyx": "requests.get('/v2/phone_numbers')"},
        "webhooks": "Telnyx sends JSON POST with data.event_type field for all events"}}), 200

@app.route("/migration-log", methods=["GET"])
def get_log():
    return jsonify({"log": migration_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "migrations": len(migration_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
