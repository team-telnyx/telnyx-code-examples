#!/usr/bin/env python3
"""Patient Appointment Engine - AI answers calls, checks availability, books appointments, collects copay via Stripe, sends SMS confirmation. Staff reviews next-day schedule."""
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
STAFF_SLACK_WEBHOOK = os.getenv("STAFF_SLACK_WEBHOOK", "")
stripe.api_key = STRIPE_API_KEY
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

appointments = []
available_slots = [
    {"date": "2026-06-19", "time": "09:00", "provider": "Dr. Smith", "type": "general"},
    {"date": "2026-06-19", "time": "10:00", "provider": "Dr. Smith", "type": "general"},
    {"date": "2026-06-19", "time": "14:00", "provider": "Dr. Patel", "type": "specialist"},
    {"date": "2026-06-20", "time": "09:00", "provider": "Dr. Smith", "type": "general"},
    {"date": "2026-06-20", "time": "11:00", "provider": "Dr. Patel", "type": "specialist"},
]
calls = {}

SYSTEM_PROMPT = """You are a medical office assistant for Valley Health Clinic. You help patients book appointments.
Available providers: Dr. Smith (general), Dr. Patel (specialist).
Collect: patient name, reason for visit, preferred date/time, insurance provider.
If urgent symptoms (chest pain, difficulty breathing, severe bleeding), tell them to call 911.
Be warm but efficient. HIPAA compliant - never discuss other patients."""

def ai_respond(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 200, "temperature": 0.3}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "I apologize, I'm having trouble right now. Let me transfer you to our front desk."

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers,
        json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def notify_staff(message):
    if STAFF_SLACK_WEBHOOK:
        try:
            requests.post(STAFF_SLACK_WEBHOOK, json={"text": message}, timeout=5)
        except Exception:
            pass

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    caller = data.get("from", "")

    if event == "call.initiated":
        if data.get("direction") == "incoming":
            requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.answered":
        calls[ccid] = {"caller": caller, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}],
            "patient_name": None, "collected": {}}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling Valley Health Clinic. I can help you schedule an appointment. What is your name?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 2, "timeout_secs": 20,
                "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.gather.ended":
        speech = data.get("speech", {}).get("result", "")
        call = calls.get(ccid, {})
        if speech and call:
            call["conversation"].append({"role": "user", "content": speech})
            slots_info = "Available slots: " + ", ".join(
                [f"{s['date']} at {s['time']} with {s['provider']}" for s in available_slots])
            call["conversation"].append({"role": "system", "content": slots_info})
            response = ai_respond(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            # Check if booking is confirmed
            if any(word in response.lower() for word in ["confirmed", "booked", "scheduled"]):
                appt = {"patient": speech, "caller": call["caller"],
                    "booked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "pending_review",
                    "conversation_summary": response}
                appointments.append(appt)
                notify_staff(f"New appointment booked: {json.dumps(appt, indent=2)}")
                send_sms(call["caller"], f"Valley Health Clinic: Your appointment has been requested. You will receive a confirmation once reviewed by our staff.")
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.hangup":
        calls.pop(ccid, None)
        return jsonify({"status": "ok"}), 200

    return jsonify({"status": "ok"}), 200

@app.route("/appointments", methods=["GET"])
def list_appointments():
    return jsonify({"appointments": appointments, "pending_review": sum(1 for a in appointments if a["status"] == "pending_review")}), 200

@app.route("/appointments/<int:idx>/approve", methods=["POST"])
def approve_appointment(idx):
    if idx >= len(appointments):
        return jsonify({"error": "Not found"}), 404
    appt = appointments[idx]
    appt["status"] = "confirmed"
    appt["approved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    send_sms(appt["caller"], "Valley Health Clinic: Your appointment is confirmed. Reply CANCEL to cancel.")
    return jsonify({"appointment": appt}), 200

@app.route("/appointments/<int:idx>/reject", methods=["POST"])
def reject_appointment(idx):
    if idx >= len(appointments):
        return jsonify({"error": "Not found"}), 404
    data = request.get_json() or {}
    appt = appointments[idx]
    appt["status"] = "rejected"
    appt["reason"] = data.get("reason", "")
    send_sms(appt["caller"], f"Valley Health Clinic: We need to reschedule your appointment. Please call us at {MAIN_NUMBER}.")
    return jsonify({"appointment": appt}), 200

@app.route("/copay/create", methods=["POST"])
def create_copay():
    data = request.get_json()
    try:
        link = stripe.PaymentLink.create(
            line_items=[{"price_data": {"currency": "usd", "product_data": {"name": f"Copay - {data.get('provider', 'Visit')}"},
                "unit_amount": data.get("amount_cents", 2500)}, "quantity": 1}])
        send_sms(data["phone"], f"Valley Health Clinic: Please pay your ${data.get('amount_cents', 2500)/100:.2f} copay before your visit: {link.url}")
        return jsonify({"payment_link": link.url}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/slots", methods=["GET"])
def get_slots():
    return jsonify({"available": available_slots}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "appointments": len(appointments),
        "pending": sum(1 for a in appointments if a["status"] == "pending_review")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
