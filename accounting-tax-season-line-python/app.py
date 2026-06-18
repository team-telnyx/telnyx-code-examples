#!/usr/bin/env python3
"""Accounting Firm Tax Season Line - handles scheduling, document checklist reminders, status updates. AI texts clients with missing doc reminders. CPA reviews readiness before appointments."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CPA_SLACK = os.getenv("CPA_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

clients = [
    {"name": "John & Mary Smith", "phone": "+15559006001", "type": "personal", "appointment": "2026-07-01",
        "docs_needed": ["W-2", "1099-INT", "Mortgage Statement", "Charity Receipts"],
        "docs_received": ["W-2"], "status": "docs_pending"},
    {"name": "Acme Corp", "phone": "+15559006002", "type": "business", "appointment": "2026-07-05",
        "docs_needed": ["P&L Statement", "Balance Sheet", "1099-NEC forms", "Payroll Reports", "Bank Statements"],
        "docs_received": ["P&L Statement", "Balance Sheet"], "status": "docs_pending"},
]
calls = {}

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/reminders/send", methods=["POST"])
def send_reminders():
    results = []
    for client in clients:
        if client["status"] != "docs_pending": continue
        missing = [d for d in client["docs_needed"] if d not in client["docs_received"]]
        if not missing:
            client["status"] = "ready"
            continue
        missing_str = ", ".join(missing)
        send_sms(client["phone"], f"Hi {client['name']}, your tax appointment is {client['appointment']}. We still need: {missing_str}. Please send or upload ASAP. Reply HELP for our secure upload link.")
        results.append({"client": client["name"], "missing": missing, "appointment": client["appointment"]})
    return jsonify({"reminders_sent": len(results), "results": results}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    caller = data.get("from", "")
    if event == "call.initiated" and data.get("direction") == "incoming":
        requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
    elif event == "call.answered":
        client = next((c for c in clients if c["phone"]==caller), None)
        if client:
            missing = [d for d in client["docs_needed"] if d not in client["docs_received"]]
            prompt = f"Client {client['name']} calling. Type: {client['type']}. Appointment: {client['appointment']}. Missing docs: {', '.join(missing) if missing else 'None - ready'}."
        else:
            prompt = "Unknown caller. Ask for their name and check if they're an existing client."
        calls[ccid] = {"caller": caller, "conversation": [
            {"role":"system","content":"You are the AI assistant for Summit Tax & Accounting. Help clients with appointment scheduling, document questions, and tax preparation status. Be professional and knowledgeable."},
            {"role":"system","content":prompt}]}
        greeting = f"Thank you for calling Summit Tax and Accounting."
        if client:
            greeting += f" Hi {client['name']}, how can I help you today?"
        else:
            greeting += " How may I assist you?"
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload":greeting,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type":"speech","end_silence_timeout_secs":2,"timeout_secs":20,"language_code":"en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech",{}).get("result","")
        call = calls.get(ccid,{})
        if speech and call:
            call["conversation"].append({"role":"user","content":speech})
            try:
                resp = requests.post(INFERENCE_URL, headers=headers,
                    json={"model":AI_MODEL,"messages":call["conversation"],"max_tokens":200,"temperature":0.3}, timeout=15)
                response = resp.json()["choices"][0]["message"]["content"]
            except Exception:
                response = "Let me have our team get back to you on that."
            call["conversation"].append({"role":"assistant","content":response})
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":response,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status":"ok"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip()
    client = next((c for c in clients if c["phone"]==sender), None)
    if client:
        if text.upper() == "STATUS":
            missing = [d for d in client["docs_needed"] if d not in client["docs_received"]]
            received = len(client["docs_received"])
            total = len(client["docs_needed"])
            send_sms(sender, f"Summit Tax: {received}/{total} docs received. {'Missing: '+', '.join(missing) if missing else 'All docs received! See you on '+client['appointment']+'.'}")
        elif text.upper() == "HELP":
            send_sms(sender, "Summit Tax: Upload docs at https://portal.example.com/upload or email to docs@summittax.com. Reply STATUS to check document status.")
    return jsonify({"status":"ok"}), 200

@app.route("/clients", methods=["GET"])
def list_clients():
    return jsonify({"clients": clients}), 200

@app.route("/clients/<int:idx>/doc-received", methods=["POST"])
def doc_received(idx):
    if idx >= len(clients): return jsonify({"error":"Not found"}), 404
    data = request.get_json()
    doc = data.get("document")
    if doc and doc not in clients[idx]["docs_received"]:
        clients[idx]["docs_received"].append(doc)
    missing = [d for d in clients[idx]["docs_needed"] if d not in clients[idx]["docs_received"]]
    if not missing:
        clients[idx]["status"] = "ready"
        send_sms(clients[idx]["phone"], f"Summit Tax: All documents received! You're all set for your appointment on {clients[idx]['appointment']}.")
        if CPA_SLACK:
            try: requests.post(CPA_SLACK, json={"text": f"Client ready: {clients[idx]['name']} - appointment {clients[idx]['appointment']}"}, timeout=5)
            except Exception: pass
    return jsonify({"client": clients[idx], "missing": missing}), 200

@app.route("/readiness", methods=["GET"])
def readiness_dashboard():
    ready = sum(1 for c in clients if c["status"]=="ready")
    pending = sum(1 for c in clients if c["status"]=="docs_pending")
    return jsonify({"ready":ready,"pending":pending,"clients":[
        {"name":c["name"],"status":c["status"],
            "docs_received":len(c["docs_received"]),"docs_needed":len(c["docs_needed"]),
            "appointment":c["appointment"]}
        for c in clients]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","clients":len(clients)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
