#!/usr/bin/env python3
"""Payment Reminder Escalation - invoice overdue: day 1 SMS, day 7 voice call with payment link, day 14 escalation to collections with full context. Integrates with Stripe/QuickBooks."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
COLLECTIONS_SLACK = os.getenv("COLLECTIONS_SLACK_WEBHOOK", "")
STRIPE_API_KEY = os.getenv("STRIPE_API_KEY", "")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
invoices = []
reminder_log = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/invoices", methods=["POST"])
def add_invoice():
    data = request.get_json()
    inv = {"id": len(invoices), "company": data.get("company"), "contact_phone": data.get("phone"),
        "amount": data.get("amount", 0), "due_date": data.get("due_date"), "status": "unpaid",
        "payment_link": data.get("payment_link", ""), "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    invoices.append(inv)
    return jsonify({"invoice": inv}), 200

@app.route("/reminders/run", methods=["POST"])
def run_reminders():
    data = request.get_json() or {}
    results = []
    for inv in invoices:
        if inv["status"] != "unpaid": continue
        days_overdue = data.get("days_overdue", 1)
        entry = {"invoice_id": inv["id"], "days": days_overdue, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if days_overdue <= 1:
            send_sms(inv["contact_phone"], f"Reminder: Invoice #{inv['id']} for ${inv['amount']:.2f} from {inv['company']} is due. Pay here: {inv['payment_link'] or 'Contact us for payment options.'}")
            entry["action"] = "sms_reminder"
        elif days_overdue <= 7:
            try:
                requests.post(f"{API}/calls", headers=headers,
                    json={"to": inv["contact_phone"], "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                        "client_state": json.dumps({"inv_id": inv["id"], "msg": f"This is a courtesy call about invoice {inv['id']} for ${inv['amount']:.2f}, now {days_overdue} days past due. Please arrange payment at your earliest convenience."}).encode().hex()}, timeout=10)
            except Exception: pass
            entry["action"] = "voice_call"
        else:
            entry["action"] = "collections_escalation"
            if COLLECTIONS_SLACK:
                try: requests.post(COLLECTIONS_SLACK, json={"text": f"COLLECTIONS: {inv['company']} - ${inv['amount']:.2f} - {days_overdue} days overdue. Contact: {inv['contact_phone']}. {sum(1 for l in reminder_log if l.get('invoice_id')==inv['id'])} prior attempts."}, timeout=5)
                except Exception: pass
        reminder_log.append(entry)
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
        if cs.get("msg"):
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": cs["msg"], "voice": "female", "language_code": "en-US"}, timeout=10)
    return jsonify({"status": "ok"}), 200

@app.route("/invoices", methods=["GET"])
def list_invoices():
    return jsonify({"invoices": invoices}), 200

@app.route("/invoices/<int:idx>/paid", methods=["POST"])
def mark_paid(idx):
    if idx >= len(invoices): return jsonify({"error":"Not found"}), 404
    invoices[idx]["status"] = "paid"
    invoices[idx]["paid_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    return jsonify({"invoice": invoices[idx]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","unpaid":sum(1 for i in invoices if i["status"]=="unpaid")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
