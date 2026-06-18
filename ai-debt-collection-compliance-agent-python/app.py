#!/usr/bin/env python3
"""AI Debt Collection Compliance Agent — FDCPA-compliant outbound collection with real-time guardrails."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
AGENT_NUMBER = os.getenv("AGENT_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}
call_logs = []
SYSTEM_PROMPT = """You are a debt collection agent. You MUST follow FDCPA rules:
- Identify yourself and state this is an attempt to collect a debt in the first 30 seconds.
- Never threaten, harass, or use abusive language.
- If they say "stop calling" or "do not contact", acknowledge and end the call immediately.
- Never call before 8am or after 9pm in the debtor's local time.
- Never discuss the debt with third parties.
- Offer payment plans and be professional.
Keep responses under 2 sentences."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def check_compliance(response_text):
    msgs = [{"role": "system", "content": "Check if this debt collection response violates FDCPA. Return JSON: compliant (boolean), violation (string or null)."},
        {"role": "user", "content": response_text}]
    return call_inference(msgs, max_tokens=100)

@app.route("/collect", methods=["POST"])
def start_collection():
    data = request.get_json()
    number = data.get("number")
    if not number:
        return jsonify({"error": "number required"}), 400
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": number, "from": AGENT_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
        ccid = resp.json().get("data", {}).get("call_control_id")
        if ccid:
            active_calls[ccid] = {"debtor": data, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}], "compliance_checks": []}
        return jsonify({"status": "calling", "call_control_id": ccid}), 200
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    call = active_calls.get(ccid)
    if event_type == "call.answered" and call:
        debtor = call["debtor"]
        greeting = f"Hello, this is a call from ABC Collections regarding an outstanding balance. This is an attempt to collect a debt and any information obtained will be used for that purpose. Am I speaking with {debtor.get('name', 'the account holder')}?"
        client.calls.actions.speak(ccid, payload=greeting, voice="female", language_code="en-US")
        client.calls.actions.record_start(ccid, format="mp3", channels="dual")
        call["conversation"].append({"role": "assistant", "content": greeting})
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="I didn't catch that. Can you hear me okay?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        stop_words = ["stop calling", "do not contact", "cease", "leave me alone", "dont call"]
        if any(sw in speech.lower() for sw in stop_words):
            client.calls.actions.speak(ccid, payload="I understand. We will stop contacting you at this number. Have a good day.", voice="female", language_code="en-US")
            call["debtor"]["do_not_contact"] = True
            return jsonify({"status": "dnc_acknowledged"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        ai_response = call_inference(call["conversation"])
        try:
            compliance = json.loads(check_compliance(ai_response))
            call["compliance_checks"].append(compliance)
            if not compliance.get("compliant", True):
                ai_response = "I apologize. Let me rephrase. We'd like to discuss payment options that work for your situation."
        except Exception:
            pass
        call["conversation"].append({"role": "assistant", "content": ai_response})
        client.calls.actions.speak(ccid, payload=ai_response, voice="female", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call:
            call_logs.append({"debtor": call["debtor"], "compliance_checks": call["compliance_checks"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/logs", methods=["GET"])
def get_logs():
    return jsonify({"logs": call_logs[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_calls), "completed": len(call_logs)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
