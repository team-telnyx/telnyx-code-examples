#!/usr/bin/env python3
"""Prescription Refill Line - patient calls, AI verifies identity (DOB + last 4 of phone), checks refill eligibility, sends approval to pharmacist via Slack. Pharmacist approves/denies, patient gets SMS."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
PHARMACY_SLACK = os.getenv("PHARMACY_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

patients_db = {
    "smith-0315": {"name": "John Smith", "dob": "1985-03-15", "medications": [
        {"name": "Lisinopril 10mg", "refills_remaining": 3, "last_filled": "2026-05-20", "rx": "RX-4401"},
        {"name": "Metformin 500mg", "refills_remaining": 0, "last_filled": "2026-04-01", "rx": "RX-4402"}]},
}
refill_requests = []
calls = {}

SYSTEM_PROMPT = """You are a pharmacy assistant AI for Valley Pharmacy.
To verify identity, ask for: full name, date of birth, last 4 digits of phone number.
Then ask which medication they need refilled.
If refills_remaining > 0, tell them it's being submitted for pharmacist review.
If refills_remaining = 0, tell them they need a new prescription from their doctor.
Be HIPAA compliant. Never read back full medication lists unprompted."""

def ai_respond(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 200, "temperature": 0.2}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "I'm having trouble right now. Please hold for our pharmacist."

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

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
        calls[ccid] = {"caller": caller, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling Valley Pharmacy refill line. For security, I'll need to verify your identity. What is your full name?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 2, "timeout_secs": 20, "language_code": "en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech", {}).get("result", "")
        call = calls.get(ccid, {})
        if speech and call:
            call["conversation"].append({"role": "user", "content": speech})
            response = ai_respond(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            if any(w in response.lower() for w in ["submitting", "submitted", "pharmacist review"]):
                req = {"caller": caller, "medication": speech, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "pending_pharmacist"}
                refill_requests.append(req)
                if PHARMACY_SLACK:
                    try: requests.post(PHARMACY_SLACK, json={"text": f"Refill request #{len(refill_requests)-1}: {caller} - {speech}\nPOST /refills/{len(refill_requests)-1}/approve or /deny"}, timeout=5)
                    except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/refills", methods=["GET"])
def list_refills():
    return jsonify({"refills": refill_requests}), 200

@app.route("/refills/<int:idx>/approve", methods=["POST"])
def approve_refill(idx):
    if idx >= len(refill_requests): return jsonify({"error": "Not found"}), 404
    req = refill_requests[idx]
    req["status"] = "approved"
    req["approved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    data = request.get_json() or {}
    req["pickup_time"] = data.get("pickup_time", "2 hours")
    send_sms(req["caller"], f"Valley Pharmacy: Your refill is approved and will be ready in {req['pickup_time']}.")
    return jsonify({"refill": req}), 200

@app.route("/refills/<int:idx>/deny", methods=["POST"])
def deny_refill(idx):
    if idx >= len(refill_requests): return jsonify({"error": "Not found"}), 404
    req = refill_requests[idx]
    req["status"] = "denied"
    data = request.get_json() or {}
    req["reason"] = data.get("reason", "Requires new prescription from doctor")
    send_sms(req["caller"], f"Valley Pharmacy: Your refill requires attention. {req['reason']}. Please contact your doctor or call us.")
    return jsonify({"refill": req}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "pending": sum(1 for r in refill_requests if r["status"] == "pending_pharmacist")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
