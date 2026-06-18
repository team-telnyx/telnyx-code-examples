#!/usr/bin/env python3
"""AI Medical Appointment Prep Caller — calls patients before appointments to collect intake info."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CLINIC_NUMBER = os.getenv("CLINIC_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}
intake_records = []

SYSTEM_PROMPT = """You are a medical office pre-appointment assistant. Collect:
1. Confirm identity (name and date of birth)
2. Any changes to medications since last visit
3. Current symptoms or reason for visit
4. Allergies (confirm or update)
5. Insurance changes
Be gentle, patient, and professional. NEVER give medical advice. If they describe an emergency, tell them to call 911.
Keep responses under 2 sentences."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/prep-call", methods=["POST"])
def start_prep_call():
    data = request.get_json()
    number = data.get("phone")
    patient = data.get("patient_name", "")
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": number, "from": CLINIC_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
        ccid = resp.json().get("data", {}).get("call_control_id")
        if ccid:
            active_calls[ccid] = {"patient": data, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}]}
        return jsonify({"status": "calling"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    call = active_calls.get(ccid)
    if event_type == "call.answered" and call:
        name = call["patient"].get("patient_name", "")
        client.calls.actions.speak(ccid, payload=f"Hi, this is the doctor's office calling about your upcoming appointment. For verification, can you confirm your full name and date of birth?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="I didn't catch that. Could you repeat?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and len(call["conversation"]) > 3:
            extract_msgs = [{"role": "system", "content": "Extract intake data. Return JSON: identity_confirmed (boolean), medication_changes (string or null), symptoms (string or null), allergies (string or null), insurance_changes (string or null), complete (boolean)."},
                {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in call['conversation'] if m['role'] != 'system')}]
            try:
                intake = json.loads(call_inference(extract_msgs, max_tokens=300))
                intake["patient"] = call["patient"]
                intake["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                intake_records.append(intake)
            except Exception:
                pass
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/intakes", methods=["GET"])
def list_intakes():
    return jsonify({"intakes": intake_records[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "intakes": len(intake_records), "active": len(active_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
