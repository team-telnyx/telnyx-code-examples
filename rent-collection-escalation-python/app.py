#!/usr/bin/env python3
"""Rent Collection Escalation - automated multi-channel rent reminders. Day 1: SMS + Stripe payment link. Day 3: voice call. Day 7: late fee notice. Day 14: manager escalation."""
import os, json, time, requests, stripe
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
STRIPE_API_KEY = os.getenv("STRIPE_API_KEY")
MANAGER_SLACK = os.getenv("MANAGER_SLACK_WEBHOOK", "")
stripe.api_key = STRIPE_API_KEY
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

tenants = [
    {"name": "Sarah Johnson", "phone": "+15559001234", "unit": "4B", "rent": 1500, "status": "current"},
    {"name": "Mike Chen", "phone": "+15559005678", "unit": "7A", "rent": 1800, "status": "current"},
]
collection_log = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def make_call(to, message):
    try:
        resp = requests.post(f"{API}/calls", headers=headers,
            json={"to": to, "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps({"msg": message}).encode().hex()}, timeout=10)
        return resp.json().get("data", {}).get("call_control_id")
    except Exception:
        return None

@app.route("/collections/run", methods=["POST"])
def run_cycle():
    data = request.get_json() or {}
    day = data.get("day_overdue", 1)
    results = []
    for t in tenants:
        if t["status"] != "overdue": continue
        entry = {"tenant": t["name"], "unit": t["unit"], "day": day, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if day <= 1:
            try:
                session = stripe.checkout.Session.create(mode="payment", success_url="https://example.com/paid",
                    line_items=[{"price_data": {"currency":"usd","product_data":{"name":f"Rent Unit {t['unit']}"},"unit_amount":t["rent"]*100},"quantity":1}])
                link = session.url
            except Exception:
                link = None
            send_sms(t["phone"], f"Hi {t['name']}, rent of ${t['rent']} for Unit {t['unit']} is due. Pay here: {link or 'Call our office.'}")
            entry["action"] = "sms_payment_link"
        elif day <= 3:
            make_call(t["phone"], f"Hello {t['name']}, this is Oak Manor about your rent for Unit {t['unit']}. ${t['rent']} is {day} days past due.")
            entry["action"] = "voice_call"
        elif day <= 7:
            fee = t["rent"] * 0.05
            send_sms(t["phone"], f"NOTICE: {t['name']}, Unit {t['unit']} rent is {day} days late. Late fee: ${fee:.2f}. Total: ${t['rent']+fee:.2f}.")
            entry["action"] = "late_fee_notice"
        else:
            entry["action"] = "manager_escalation"
            if MANAGER_SLACK:
                try: requests.post(MANAGER_SLACK, json={"text": f"ESCALATION: {t['name']} Unit {t['unit']} - {day} days overdue, ${t['rent']}. {sum(1 for l in collection_log if l.get('unit')==t['unit'])} prior attempts."}, timeout=5)
                except Exception: pass
        collection_log.append(entry)
        results.append(entry)
    return jsonify({"results": results}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    if event == "call.answered":
        cs_hex = data.get("client_state", "")
        if cs_hex:
            try:
                cs = json.loads(bytes.fromhex(cs_hex).decode())
                requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                    json={"payload": cs.get("msg",""), "voice":"female","language_code":"en-US"}, timeout=10)
            except Exception: pass
    return jsonify({"status": "ok"}), 200

@app.route("/tenants", methods=["GET"])
def list_tenants():
    return jsonify({"tenants": tenants}), 200

@app.route("/tenants/<int:idx>/status", methods=["PUT"])
def update_status(idx):
    if idx >= len(tenants): return jsonify({"error":"Not found"}), 404
    tenants[idx]["status"] = (request.get_json() or {}).get("status", tenants[idx]["status"])
    return jsonify({"tenant": tenants[idx]}), 200

@app.route("/collections/log", methods=["GET"])
def get_log():
    return jsonify({"log": collection_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","overdue":sum(1 for t in tenants if t["status"]=="overdue")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
