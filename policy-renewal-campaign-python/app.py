#!/usr/bin/env python3
"""Policy Renewal Campaign - automated multi-channel renewal reminders. 60 days: SMS. 30 days: AI voice call reviewing coverage changes. 7 days: urgent SMS. Agent reviews lapsed policies for win-back."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
AGENT_SLACK = os.getenv("AGENT_SLACK_WEBHOOK", "")
STRIPE_API_KEY = os.getenv("STRIPE_API_KEY", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

policies = [
    {"id": "POL-2001", "name": "Mike Johnson", "phone": "+15559005001", "type": "auto",
        "premium": 1200, "expiry": "2026-08-15", "status": "active", "years_with_us": 3},
    {"id": "POL-2002", "name": "Lisa Park", "phone": "+15559005002", "type": "home",
        "premium": 2400, "expiry": "2026-07-20", "status": "active", "years_with_us": 7},
]
campaign_log = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/campaigns/run", methods=["POST"])
def run_campaign():
    data = request.get_json() or {}
    days_to_expiry = data.get("days_to_expiry", 60)
    results = []
    for pol in policies:
        if pol["status"] != "active": continue
        entry = {"policy": pol["id"], "name": pol["name"], "days": days_to_expiry,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if days_to_expiry >= 60:
            send_sms(pol["phone"], f"Hi {pol['name']}, your {pol['type']} policy {pol['id']} renews on {pol['expiry']}. Premium: ${pol['premium']}/yr. Questions? Reply or call us at {MAIN_NUMBER}.")
            entry["action"] = "60_day_sms"
        elif days_to_expiry >= 30:
            try:
                requests.post(f"{API}/calls", headers=headers,
                    json={"to": pol["phone"], "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                        "client_state": json.dumps({"pol_id": pol["id"]}).encode().hex()}, timeout=10)
            except Exception: pass
            entry["action"] = "30_day_voice"
        elif days_to_expiry >= 7:
            send_sms(pol["phone"], f"URGENT: {pol['name']}, your {pol['type']} policy expires {pol['expiry']}. Renew now to avoid a coverage gap. Call {MAIN_NUMBER} or reply RENEW.")
            entry["action"] = "7_day_urgent"
        else:
            entry["action"] = "lapsed_winback"
            if AGENT_SLACK:
                try: requests.post(AGENT_SLACK, json={"text": f"LAPSED: {pol['name']} - {pol['type']} policy {pol['id']}, ${pol['premium']}/yr, {pol['years_with_us']} years. Win-back call needed."}, timeout=5)
                except Exception: pass
        campaign_log.append(entry)
        results.append(entry)
    return jsonify({"results": results}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    if event == "call.answered":
        cs = {}
        try: cs = json.loads(bytes.fromhex(data.get("client_state","")).decode())
        except Exception: pass
        pol = next((p for p in policies if p["id"]==cs.get("pol_id")), None)
        if pol:
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": f"Hi {pol['name']}, this is SecureShield Insurance. Your {pol['type']} policy is coming up for renewal on {pol['expiry']}. Your current premium is ${pol['premium']} per year. As a valued customer of {pol['years_with_us']} years, I wanted to personally make sure you're aware of your options. Press 1 to renew at the current rate, press 2 to discuss changes with an agent.",
                    "voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type":"dtmf","timeout_secs":15,"valid_digits":"12","max_digits":1}, timeout=10)
    elif event == "call.gather.ended":
        digits = data.get("dtmf",{}).get("digits","")
        cs = {}
        try: cs = json.loads(bytes.fromhex(data.get("client_state","")).decode())
        except Exception: pass
        pol = next((p for p in policies if p["id"]==cs.get("pol_id")), None)
        if digits == "1" and pol:
            pol["status"] = "renewed"
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":"Wonderful! Your policy has been renewed. You'll receive a confirmation text. Thank you for staying with SecureShield!",
                    "voice":"female","language_code":"en-US"}, timeout=10)
            send_sms(pol["phone"], f"SecureShield: Policy {pol['id']} renewed for ${pol['premium']}/yr. Effective through next year. Thank you!")
        elif digits == "2" and AGENT_SLACK:
            try: requests.post(AGENT_SLACK, json={"text": f"Renewal call transfer: {pol['name']} wants to discuss {pol['type']} policy {pol['id']}"}, timeout=5)
            except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":"I'll have an agent call you back within the hour. Thank you!","voice":"female","language_code":"en-US"}, timeout=10)
    return jsonify({"status":"ok"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip().upper()
    if text == "RENEW":
        pol = next((p for p in policies if p["phone"]==sender and p["status"]=="active"), None)
        if pol:
            pol["status"] = "renewed"
            send_sms(sender, f"SecureShield: Policy {pol['id']} renewed! Confirmation will be mailed.")
    return jsonify({"status":"ok"}), 200

@app.route("/policies", methods=["GET"])
def list_policies():
    return jsonify({"policies": policies}), 200

@app.route("/campaign-log", methods=["GET"])
def get_log():
    return jsonify({"log": campaign_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","active":sum(1 for p in policies if p["status"]=="active")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
