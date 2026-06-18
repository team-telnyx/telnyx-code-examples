#!/usr/bin/env python3
"""Fraud Alert & Verification - suspicious transaction triggers voice call to customer, verifies via DTMF, blocks or approves in real-time. Fraud team reviews edge cases via Slack."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
FRAUD_SLACK = os.getenv("FRAUD_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

alerts = []
active_calls = {}

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/alerts/trigger", methods=["POST"])
def trigger_alert():
    data = request.get_json()
    alert = {"id": len(alerts), "customer_phone": data.get("phone"),
        "transaction": data.get("transaction", ""), "amount": data.get("amount", 0),
        "merchant": data.get("merchant", ""), "risk_score": data.get("risk_score", 0),
        "status": "calling", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    alerts.append(alert)
    try:
        resp = requests.post(f"{API}/calls", headers=headers,
            json={"to": alert["customer_phone"], "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps({"alert_id": alert["id"]}).encode().hex()}, timeout=10)
        active_calls[resp.json().get("data",{}).get("call_control_id","")] = alert["id"]
    except Exception:
        alert["status"] = "call_failed"
        send_sms(alert["customer_phone"], f"FRAUD ALERT: ${alert['amount']:.2f} at {alert['merchant']}. Reply YES if this was you, NO to block. Call us at {MAIN_NUMBER}.")
    return jsonify({"alert": alert}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    alert_id = active_calls.get(ccid)

    if event == "call.answered" and alert_id is not None:
        alert = alerts[alert_id]
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": f"This is your bank's fraud prevention team. We detected a charge of ${alert['amount']:.2f} at {alert['merchant']}. If you made this purchase, press 1. If you did NOT make this purchase, press 2. To speak with a fraud specialist, press 3.",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended" and alert_id is not None:
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "dtmf", "timeout_secs": 15, "valid_digits": "123", "max_digits": 1}, timeout=10)
    elif event == "call.gather.ended" and alert_id is not None:
        digits = data.get("dtmf", {}).get("digits", "")
        alert = alerts[alert_id]
        if digits == "1":
            alert["status"] = "verified_legitimate"
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "Thank you for confirming. The transaction has been approved. Goodbye.",
                    "voice": "female", "language_code": "en-US"}, timeout=10)
        elif digits == "2":
            alert["status"] = "blocked"
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "We've blocked this transaction and flagged your account for review. A specialist will call you within the hour. Your card has been temporarily frozen. Goodbye.",
                    "voice": "female", "language_code": "en-US"}, timeout=10)
            send_sms(alert["customer_phone"], f"BLOCKED: ${alert['amount']:.2f} at {alert['merchant']}. Card frozen. Call us at {MAIN_NUMBER} for a replacement.")
            if FRAUD_SLACK:
                try: requests.post(FRAUD_SLACK, json={"text": f"BLOCKED: Alert #{alert_id} - ${alert['amount']:.2f} at {alert['merchant']}. Customer {alert['customer_phone']} confirmed fraud."}, timeout=5)
                except Exception: pass
        elif digits == "3":
            alert["status"] = "escalated"
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "Connecting you with a fraud specialist now.", "voice": "female", "language_code": "en-US"}, timeout=10)
            if FRAUD_SLACK:
                try: requests.post(FRAUD_SLACK, json={"text": f"ESCALATION: Alert #{alert_id} requesting live agent. ${alert['amount']:.2f} at {alert['merchant']}."}, timeout=5)
                except Exception: pass
    elif event == "call.hangup":
        active_calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip().upper()
    alert = next((a for a in reversed(alerts) if a["customer_phone"] == sender and a["status"] in ("calling","call_failed")), None)
    if alert:
        if text == "YES":
            alert["status"] = "verified_legitimate"
            send_sms(sender, "Transaction confirmed. Thank you.")
        elif text == "NO":
            alert["status"] = "blocked"
            send_sms(sender, f"Transaction blocked. Card frozen. Call {MAIN_NUMBER} for a replacement.")
            if FRAUD_SLACK:
                try: requests.post(FRAUD_SLACK, json={"text": f"BLOCKED via SMS: Alert #{alert['id']}"}, timeout=5)
                except Exception: pass
    return jsonify({"status": "ok"}), 200

@app.route("/alerts", methods=["GET"])
def list_alerts():
    return jsonify({"alerts": alerts, "stats": {
        "total": len(alerts), "blocked": sum(1 for a in alerts if a["status"]=="blocked"),
        "verified": sum(1 for a in alerts if a["status"]=="verified_legitimate"),
        "escalated": sum(1 for a in alerts if a["status"]=="escalated")}}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","active":sum(1 for a in alerts if a["status"]=="calling")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
