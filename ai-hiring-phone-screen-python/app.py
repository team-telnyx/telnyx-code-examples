#!/usr/bin/env python3
"""AI Hiring Phone Screen — automated first-round phone screening for job applicants."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
SCREEN_NUMBER = os.getenv("SCREEN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(active_calls)

screen_results = []

SYSTEM_PROMPT = """You are conducting a phone screen for a Software Engineer role. Ask these questions one at a time:
1. Tell me briefly about your background and what interests you about this role.
2. What programming languages are you strongest in?
3. Describe a challenging technical project you led recently.
4. What's your timeline and salary expectations?
5. Do you have any questions for us?
Be professional, warm, and encouraging. Keep responses under 2 sentences. After question 5, thank them and say they'll hear back within 48 hours."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.6}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/screen", methods=["POST"])
def start_screen():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    number = data.get("phone")
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": number, "from": SCREEN_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
        ccid = resp.json().get("data", {}).get("call_control_id")
        if ccid:
            active_calls[ccid] = {"candidate": data, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}], "start": time.time()}
        return jsonify({"status": "calling"}), 200
    except Exception as e:
        app.logger.exception("Failed to start phone screen call")
        return jsonify({"error": "could not start screening call"}), 500

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    call = active_calls.get(ccid)
    if event_type == "call.answered" and call:
        name = call["candidate"].get("name", "")
        client.calls.actions.speak(ccid, payload=f"Hi {name}, thanks for taking the time to chat! I'm going to ask you a few questions about your background. Ready to get started?", voice="female", language_code="en-US")
        client.calls.actions.start_recording(ccid, format="mp3", channels="dual")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=30, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = p.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="Take your time. Could you repeat that?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call:
            score_msgs = [{"role": "system", "content": "Score this phone screen. Return JSON: overall_score (1-10), communication (1-10), technical_depth (1-10), culture_fit (1-10), recommendation (advance/hold/pass), key_strengths (list), concerns (list), summary (string)."},
                {"role": "user", "content": chr(10).join(f"{m['role']}: {m['content']}" for m in call["conversation"] if m["role"] != "system")}]
            try:
                score = call_inference(score_msgs, max_tokens=400)
                screen_results.append({"candidate": call["candidate"], "score": json.loads(score), "duration": int(time.time() - call["start"])})
            except Exception:
                screen_results.append({"candidate": call["candidate"], "duration": int(time.time() - call["start"])})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/results", methods=["GET"])
def get_results():
    return jsonify({"results": screen_results[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_calls), "completed": len(screen_results)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
