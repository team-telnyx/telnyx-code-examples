#!/usr/bin/env python3
"""AI Restaurant Reservation Voice Agent — handles calls, checks availability, books tables, sends SMS confirmation."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
RESTAURANT_NUMBER = os.getenv("RESTAURANT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
reservations = []
active_calls = {}

SYSTEM_PROMPT = """You are the AI host at Bella Cucina Italian Restaurant.
Hours: Tue-Sun 5pm-10pm, closed Monday. Capacity: 20 tables (2-8 guests).
Menu highlights: housemade pasta, wood-fired pizza, seasonal specials.
You can: book reservations, answer menu questions, provide hours/location, handle dietary requests.
Keep responses under 2 sentences. Be warm and professional."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": RESTAURANT_NUMBER, "to": to, "text": text, "messaging_profile_id": os.getenv("MESSAGING_PROFILE_ID", "")}, timeout=10)
    except Exception as e:
        app.logger.error(f"SMS failed: {e}")

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    call = active_calls.get(ccid)
    if event_type == "call.initiated" and data.get("direction") == "incoming":
        active_calls[ccid] = {"caller": data.get("from"), "conversation": [{"role": "system", "content": SYSTEM_PROMPT}]}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Thank you for calling Bella Cucina! Would you like to make a reservation, or do you have a question?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="Sorry, I didn't catch that. How can I help you?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        # Check if booking was made
        if any(word in response.lower() for word in ["reserved", "booked", "confirmed your reservation"]):
            reservation = {"caller": call["caller"], "booked_via": "voice", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
            reservations.append(reservation)
            send_sms(call["caller"], f"Your reservation at Bella Cucina is confirmed! Reply to this message if you need to change anything.")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/reservations", methods=["GET"])
def list_reservations():
    return jsonify({"reservations": reservations[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "reservations": len(reservations), "active_calls": len(active_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
