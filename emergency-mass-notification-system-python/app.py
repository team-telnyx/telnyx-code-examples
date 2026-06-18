#!/usr/bin/env python3
"""Emergency Mass Notification System — SMS + voice calls with delivery tracking and escalation."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")

notifications = {}  # notification_id -> {message, contacts, delivery_status}

@app.route("/notify", methods=["POST"])
def send_notification():
    data = request.get_json()
    message = data.get("message", "")
    contacts = data.get("contacts", [])
    severity = data.get("severity", "normal")
    nid = f"NOTIF-{int(time.time())}"
    delivery = {}
    for contact in contacts:
        phone = contact.get("phone")
        if not phone: continue
        try:
            requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                json={"from": ALERT_NUMBER, "to": phone, "text": f"[{severity.upper()}] {message}"}, timeout=10)
            delivery[phone] = {"sms": "sent", "voice": "pending" if severity == "critical" else "not_required"}
        except Exception:
            delivery[phone] = {"sms": "failed"}
        if severity == "critical":
            try:
                resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                    json={"to": phone, "from": ALERT_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
                ccid = resp.json().get("data", {}).get("call_control_id")
                delivery[phone]["voice"] = "calling"
                delivery[phone]["call_control_id"] = ccid
            except Exception:
                delivery[phone]["voice"] = "failed"
    notifications[nid] = {"message": message, "severity": severity, "contacts": len(contacts), "delivery": delivery, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    return jsonify({"notification_id": nid, "contacts_notified": len(delivery)}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    if event_type == "call.answered":
        for nid, notif in notifications.items():
            for phone, d in notif["delivery"].items():
                if d.get("call_control_id") == ccid:
                    client.calls.actions.speak(ccid, payload=f"Emergency notification: {notif['message']}. Press 1 to acknowledge.", voice="female", language_code="en-US")
                    return jsonify({"status": "alerting"}), 200
        return jsonify({"status": "no_match"}), 200
    elif event_type == "call.speak.ended":
        client.calls.actions.gather(ccid, input_type="dtmf speech", timeout_secs=10, min_digits=1, max_digits=1)
        return jsonify({"status": "waiting_ack"}), 200
    elif event_type == "call.gather.ended":
        for nid, notif in notifications.items():
            for phone, d in notif["delivery"].items():
                if d.get("call_control_id") == ccid:
                    d["voice"] = "acknowledged"
        client.calls.actions.hangup(ccid)
        return jsonify({"status": "acknowledged"}), 200
    elif event_type == "call.hangup":
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/notifications", methods=["GET"])
def list_notifications():
    return jsonify(notifications), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "notifications": len(notifications)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
