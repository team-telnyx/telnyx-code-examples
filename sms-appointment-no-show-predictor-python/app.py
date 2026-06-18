#!/usr/bin/env python3
"""SMS Appointment No-Show Predictor — AI predicts no-shows from SMS response patterns, triggers interventions."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BOT_NUMBER = os.getenv("BOT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
patients = {}  # phone -> {appointments, response_history, no_show_risk}

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": BOT_NUMBER, "to": to, "text": text, "messaging_profile_id": os.getenv("MESSAGING_PROFILE_ID", "")}, timeout=10)
    except Exception as e:
        app.logger.error(f"SMS failed: {e}")

def predict_no_show(patient_data):
    messages = [{"role": "system", "content": "Predict no-show probability based on patient history. Return JSON: risk_score (0.0-1.0), risk_level (low/medium/high), factors (list of strings explaining why), intervention (string suggestion)."},
        {"role": "user", "content": json.dumps(patient_data)}]
    return call_inference(messages)

@app.route("/appointments", methods=["POST"])
def add_appointment():
    data = request.get_json()
    phone = data.get("phone")
    if phone not in patients:
        patients[phone] = {"appointments": [], "response_history": [], "no_shows": 0, "shows": 0}
    patients[phone]["appointments"].append({**data, "status": "scheduled"})
    # Send confirmation and track response
    send_sms(phone, f"Your appointment is scheduled for {data.get('datetime', 'soon')}. Reply YES to confirm or RESCHEDULE to change.")
    patients[phone]["response_history"].append({"type": "confirmation_sent", "time": time.time()})
    return jsonify({"status": "scheduled"}), 200

@app.route("/predict", methods=["POST"])
def run_predictions():
    predictions = []
    for phone, patient in patients.items():
        upcoming = [a for a in patient["appointments"] if a.get("status") == "scheduled"]
        if not upcoming: continue
        try:
            result = json.loads(predict_no_show(patient))
            patient["no_show_risk"] = result.get("risk_score", 0.5)
            predictions.append({"phone": phone, **result})
            if result.get("risk_level") == "high":
                intervention = result.get("intervention", "We noticed you have an upcoming appointment. Need to reschedule?")
                send_sms(phone, intervention)
        except Exception:
            pass
    return jsonify({"predictions": predictions}), 200

@app.route("/webhooks/messaging", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip().upper()
    patient = patients.get(from_number)
    if not patient: return jsonify({"status": "unknown_patient"}), 200
    patient["response_history"].append({"type": "reply", "text": text, "time": time.time()})
    if "YES" in text:
        for appt in patient["appointments"]:
            if appt.get("status") == "scheduled":
                appt["status"] = "confirmed"
                break
        send_sms(from_number, "Confirmed! See you then.")
    elif "RESCHEDULE" in text:
        send_sms(from_number, "No problem. What day/time works better?")
    return jsonify({"status": "handled"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "patients": len(patients)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
