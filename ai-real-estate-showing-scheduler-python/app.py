#!/usr/bin/env python3
"""AI Real Estate Showing Scheduler — buyers call or text, AI checks availability and books showings."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
AGENT_NUMBER = os.getenv("AGENT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
listings = [
    {"id": "123-main", "address": "123 Main St", "price": "$450,000", "beds": 3, "baths": 2, "available_times": ["Sat 10am", "Sat 2pm", "Sun 11am"]},
    {"id": "456-oak", "address": "456 Oak Ave", "price": "$325,000", "beds": 2, "baths": 1, "available_times": ["Sat 11am", "Sun 1pm", "Sun 3pm"]},
    {"id": "789-elm", "address": "789 Elm Dr", "price": "$575,000", "beds": 4, "baths": 3, "available_times": ["Sat 9am", "Sat 1pm", "Sun 10am"]},
]
showings = []
active_calls = {}

SYSTEM_PROMPT = f"""You are an AI assistant for a real estate agent. Available listings: {json.dumps(listings)}.
Help buyers schedule showings. Collect: which property, preferred time, buyer name, contact preference.
Keep voice responses under 2 sentences. Be enthusiastic but not pushy."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": AGENT_NUMBER, "to": to, "text": text, "messaging_profile_id": os.getenv("MESSAGING_PROFILE_ID", "")}, timeout=10)
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
        client.calls.actions.speak(ccid, payload="Hi! Thanks for calling about our listings. Are you interested in a specific property, or would you like to hear what's available?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="Sorry, I missed that. Which property interests you?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        if any(word in response.lower() for word in ["booked", "scheduled", "confirmed"]):
            showings.append({"caller": call["caller"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
            send_sms(call["caller"], f"Your showing is confirmed! Our agent will meet you at the property. Reply to this message if you need to reschedule.")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/webhooks/messaging", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "")
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": text}]
    response = call_inference(msgs, max_tokens=200)
    send_sms(from_number, response)
    return jsonify({"status": "responded"}), 200

@app.route("/showings", methods=["GET"])
def list_showings():
    return jsonify({"showings": showings}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "showings": len(showings), "listings": len(listings)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
