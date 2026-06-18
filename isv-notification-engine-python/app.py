#!/usr/bin/env python3
"""ISV Notification Engine - SaaS platform sends alerts via SMS/voice/WhatsApp based on customer preference and urgency. Multi-channel with fallback cascade and delivery tracking."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

customers = {
    "cust-001": {"name": "Acme Corp", "phone": "+15559003001", "preference": "sms", "fallback": ["voice", "whatsapp"]},
    "cust-002": {"name": "TechStart Inc", "phone": "+15559003002", "preference": "whatsapp", "fallback": ["sms", "voice"]},
}
notifications = []

def send_sms(to, text):
    resp = requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)
    return resp.status_code < 300

def send_whatsapp(to, text):
    resp = requests.post(f"{API}/messages", headers=headers,
        json={"from": WHATSAPP_NUMBER or MAIN_NUMBER, "to": to, "text": text, "messaging_profile_id": "", "type": "whatsapp"}, timeout=10)
    return resp.status_code < 300

def make_voice_call(to, message):
    try:
        requests.post(f"{API}/calls", headers=headers,
            json={"to": to, "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps({"msg": message}).encode().hex()}, timeout=10)
        return True
    except Exception:
        return False

def deliver(customer_id, message, urgency="normal"):
    customer = customers.get(customer_id)
    if not customer: return {"error": "customer not found"}
    channels = [customer["preference"]] + customer.get("fallback", [])
    if urgency == "critical":
        channels = ["voice", "sms", "whatsapp"]
    notif = {"id": len(notifications), "customer_id": customer_id, "message": message,
        "urgency": urgency, "attempts": [], "status": "pending",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    for channel in channels:
        attempt = {"channel": channel, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if channel == "sms":
            success = send_sms(customer["phone"], message)
        elif channel == "whatsapp":
            success = send_whatsapp(customer["phone"], message)
        elif channel == "voice":
            success = make_voice_call(customer["phone"], message)
        else:
            success = False
        attempt["success"] = success
        notif["attempts"].append(attempt)
        if success:
            notif["status"] = "delivered"
            notif["delivered_via"] = channel
            break
    else:
        notif["status"] = "failed"
    notifications.append(notif)
    return notif

@app.route("/notify", methods=["POST"])
def notify():
    data = request.get_json()
    result = deliver(data.get("customer_id"), data.get("message", ""), data.get("urgency", "normal"))
    return jsonify({"notification": result}), 200

@app.route("/notify/bulk", methods=["POST"])
def bulk_notify():
    data = request.get_json()
    results = []
    for customer_id in data.get("customer_ids", []):
        result = deliver(customer_id, data.get("message", ""), data.get("urgency", "normal"))
        results.append(result)
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
        if cs.get("msg"):
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": cs["msg"], "voice": "female", "language_code": "en-US"}, timeout=10)
    return jsonify({"status": "ok"}), 200

@app.route("/customers", methods=["GET"])
def list_customers():
    return jsonify({"customers": customers}), 200

@app.route("/customers/<cid>/preference", methods=["PUT"])
def update_preference(cid):
    if cid not in customers: return jsonify({"error":"Not found"}), 404
    data = request.get_json()
    customers[cid]["preference"] = data.get("preference", customers[cid]["preference"])
    customers[cid]["fallback"] = data.get("fallback", customers[cid].get("fallback", []))
    return jsonify({"customer": customers[cid]}), 200

@app.route("/notifications", methods=["GET"])
def list_notifications():
    return jsonify({"notifications": notifications[-100:], "stats": {
        "total": len(notifications), "delivered": sum(1 for n in notifications if n["status"]=="delivered"),
        "failed": sum(1 for n in notifications if n["status"]=="failed")}}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","notifications":len(notifications)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
