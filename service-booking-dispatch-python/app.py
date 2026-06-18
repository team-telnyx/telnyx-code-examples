#!/usr/bin/env python3
"""Service Booking & Dispatch - customer calls HVAC/plumber/electrician, AI checks tech availability, books slot, collects deposit via Stripe, texts confirmation to customer and tech."""
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
DISPATCH_SLACK = os.getenv("DISPATCH_SLACK_WEBHOOK", "")
stripe.api_key = STRIPE_API_KEY
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

techs = [
    {"name": "Dave Wilson", "phone": "+15551110001", "skills": ["hvac","general"], "schedule": {"2026-06-19": ["09:00","13:00"], "2026-06-20": ["10:00","14:00"]}},
    {"name": "Maria Garcia", "phone": "+15551110002", "skills": ["plumbing","general"], "schedule": {"2026-06-19": ["10:00","14:00"]}},
    {"name": "Tom Park", "phone": "+15551110003", "skills": ["electrical"], "schedule": {"2026-06-19": ["08:00","11:00","15:00"]}},
]
bookings = []
calls = {}

SYSTEM_PROMPT = """You are the receptionist for ProFix Home Services. We do HVAC, plumbing, and electrical.
Collect: customer name, address, service needed, preferred date/time, brief description of the issue.
Check tech availability and offer options. Mention a $50 service call deposit is required.
For emergencies (gas leak, flooding, sparking wires), dispatch immediately."""

def ai_respond(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 200, "temperature": 0.3}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "Let me connect you with our dispatcher directly."

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
        avail = "Available techs: " + "; ".join(f"{t['name']} ({','.join(t['skills'])}): {json.dumps(t['schedule'])}" for t in techs)
        calls[ccid]["conversation"].append({"role": "system", "content": avail})
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling ProFix Home Services. I can help schedule a technician. What type of service do you need - HVAC, plumbing, or electrical?",
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
            if any(w in response.lower() for w in ["booked", "confirmed", "scheduled"]):
                booking = {"caller": caller, "service": speech, "status": "pending_deposit",
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                bookings.append(booking)
                try:
                    session = stripe.checkout.Session.create(mode="payment", success_url="https://example.com/booked",
                        line_items=[{"price_data":{"currency":"usd","product_data":{"name":"Service Call Deposit"},"unit_amount":5000},"quantity":1}])
                    send_sms(caller, f"ProFix: Booking confirmed! Pay $50 deposit to lock your slot: {session.url}")
                except Exception:
                    send_sms(caller, "ProFix: Booking confirmed! We'll collect the $50 deposit at arrival.")
                if DISPATCH_SLACK:
                    try: requests.post(DISPATCH_SLACK, json={"text": f"New booking: {caller} - {speech}"}, timeout=5)
                    except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/bookings", methods=["GET"])
def list_bookings():
    return jsonify({"bookings": bookings}), 200

@app.route("/bookings/<int:idx>/assign", methods=["POST"])
def assign_tech(idx):
    if idx >= len(bookings): return jsonify({"error":"Not found"}), 404
    data = request.get_json() or {}
    b = bookings[idx]
    b["tech"] = data.get("tech_name", "")
    b["status"] = "assigned"
    tech = next((t for t in techs if t["name"] == b["tech"]), None)
    if tech:
        send_sms(tech["phone"], f"New job assigned: {b['service']}. Customer: {b['caller']}")
        send_sms(b["caller"], f"ProFix: {tech['name']} has been assigned to your service call.")
    return jsonify({"booking": b}), 200

@app.route("/techs", methods=["GET"])
def list_techs():
    return jsonify({"techs": [{"name":t["name"],"skills":t["skills"],"available_slots":t["schedule"]} for t in techs]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","bookings":len(bookings)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
