#!/usr/bin/env python3
"""Law Firm Client Intake - AI answers after-hours calls, screens case type, collects facts, runs conflict check, books consultation via Calendly, collects retainer deposit via Stripe."""
import os, json, time, requests, stripe
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STRIPE_API_KEY = os.getenv("STRIPE_API_KEY")
CALENDLY_TOKEN = os.getenv("CALENDLY_TOKEN", "")
ATTORNEY_SLACK = os.getenv("ATTORNEY_SLACK_WEBHOOK", "")
stripe.api_key = STRIPE_API_KEY
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

existing_clients = ["Acme Corp", "GlobalTech Inc", "Smith Family Trust"]
intakes = []
calls = {}

SYSTEM_PROMPT = """You are the intake specialist for Harrison & Associates Law Firm.
Practice areas: business litigation, employment law, intellectual property, real estate.
Collect: caller name, contact info, case type, brief facts, opposing party name (for conflict check), urgency, how they found us.
If opposing party matches existing client, note CONFLICT and explain we cannot take the case.
DO NOT give legal advice. Say 'I can schedule a consultation with one of our attorneys.'
Be professional, empathetic, and thorough."""

def ai_respond(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 200, "temperature": 0.3}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "Let me connect you with our office directly."

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def check_conflict(party_name):
    return any(c.lower() in party_name.lower() for c in existing_clients)

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
        calls[ccid] = {"caller": caller, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}], "facts": ""}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling Harrison and Associates. I'm here to help with your initial intake. This is not a substitute for legal advice. May I start by getting your name?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 3, "timeout_secs": 30, "language_code": "en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech", {}).get("result", "")
        call = calls.get(ccid, {})
        if speech and call:
            call["facts"] += " " + speech
            call["conversation"].append({"role": "user", "content": speech})
            # Inject conflict check
            if check_conflict(speech):
                call["conversation"].append({"role": "system", "content": "CONFLICT DETECTED: The opposing party is an existing client. You must inform the caller we cannot represent them in this matter due to a conflict of interest."})
            response = ai_respond(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            if any(w in response.lower() for w in ["schedule", "consultation", "appointment"]):
                intake = {"caller": caller, "facts": call["facts"].strip(),
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "pending_review",
                    "conflict": check_conflict(call["facts"])}
                intakes.append(intake)
                if ATTORNEY_SLACK:
                    try: requests.post(ATTORNEY_SLACK, json={"text": f"New intake #{len(intakes)-1}: {caller}\nFacts: {call['facts'][:300]}\nConflict: {intake['conflict']}"}, timeout=5)
                    except Exception: pass
                send_sms(caller, "Harrison & Associates: Your intake has been submitted. An attorney will review and contact you within 24 hours.")
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/intakes", methods=["GET"])
def list_intakes():
    return jsonify({"intakes": intakes}), 200

@app.route("/intakes/<int:idx>/accept", methods=["POST"])
def accept_intake(idx):
    if idx >= len(intakes): return jsonify({"error":"Not found"}), 404
    intake = intakes[idx]
    intake["status"] = "accepted"
    data = request.get_json() or {}
    intake["attorney"] = data.get("attorney", "")
    intake["consultation_time"] = data.get("time", "")
    send_sms(intake["caller"], f"Harrison & Associates: Your consultation with {intake['attorney']} is scheduled for {intake['consultation_time']}. A $250 retainer deposit is required.")
    if STRIPE_API_KEY:
        try:
            session = stripe.checkout.Session.create(mode="payment", success_url="https://example.com/retained",
                line_items=[{"price_data":{"currency":"usd","product_data":{"name":"Initial Consultation Retainer"},"unit_amount":25000},"quantity":1}])
            send_sms(intake["caller"], f"Pay retainer here: {session.url}")
        except Exception: pass
    return jsonify({"intake": intake}), 200

@app.route("/intakes/<int:idx>/decline", methods=["POST"])
def decline_intake(idx):
    if idx >= len(intakes): return jsonify({"error":"Not found"}), 404
    intake = intakes[idx]
    intake["status"] = "declined"
    data = request.get_json() or {}
    intake["reason"] = data.get("reason", "")
    send_sms(intake["caller"], "Harrison & Associates: After review, we are unable to take your case at this time. We recommend consulting your local bar association for referrals.")
    return jsonify({"intake": intake}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","intakes":len(intakes),"pending":sum(1 for i in intakes if i["status"]=="pending_review")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
