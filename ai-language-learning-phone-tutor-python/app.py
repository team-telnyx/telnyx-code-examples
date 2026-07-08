#!/usr/bin/env python3
"""AI Language Learning Phone Tutor — call a number, practice a foreign language with AI."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
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

session_history = []
_start_ttl_cleanup(session_history)

LANGUAGES = {"1": {"name": "Spanish", "code": "es"}, "2": {"name": "French", "code": "fr"}, "3": {"name": "Japanese", "code": "ja"}, "4": {"name": "Mandarin", "code": "zh"}}

def call_inference(messages, max_tokens=200):
    try:
        resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    except requests.exceptions.RequestException as e:
        app.logger.error("Inference request failed: %s", e)
        return None
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

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
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[ccid] = {"caller": p.get("from"), "state": "language_select", "conversation": []}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered" and call:
        client.calls.actions.speak(ccid, payload="Welcome to Language Tutor! Press 1 for Spanish, 2 for French, 3 for Japanese, 4 for Mandarin.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        if call["state"] == "language_select":
            client.calls.actions.gather(ccid, input_type="dtmf speech", timeout_secs=10, min_digits=1, max_digits=1)
        else:
            client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        digits = p.get("digits", "")
        speech = p.get("speech", {}).get("result", "")
        if call["state"] == "language_select":
            lang_key = digits or speech.strip()[:1]
            lang = LANGUAGES.get(lang_key, LANGUAGES["1"])
            call["language"] = lang
            call["state"] = "tutoring"
            call["conversation"] = [{"role": "system", "content": f"You are a {lang['name']} language tutor. Start with a simple greeting in {lang['name']}, then English translation. Gradually increase difficulty. Correct mistakes gently. Mix {lang['name']} and English. Keep each response short for phone conversation."}]
            intro = call_inference(call["conversation"] + [{"role": "user", "content": "Start the lesson."}])
            if not intro:
                intro = "Sorry, I had trouble generating a response. Let's try again."
            call["conversation"].append({"role": "assistant", "content": intro})
            client.calls.actions.speak(ccid, payload=intro, voice="female", language_code="en-US")
        elif call["state"] == "tutoring" and speech:
            call["conversation"].append({"role": "user", "content": speech})
            response = call_inference(call["conversation"])
            if not response:
                response = "Sorry, I didn't catch that. Could you repeat what you said?"
            call["conversation"].append({"role": "assistant", "content": response})
            client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        else:
            client.calls.actions.speak(ccid, payload="Try again! Say something in the language you're learning.", voice="female", language_code="en-US")
        return jsonify({"status": "processing"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and call.get("conversation"):
            session_history.append({"caller": call["caller"], "language": call.get("language", {}).get("name"), "exchanges": len(call["conversation"]) // 2})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/sessions", methods=["GET"])
def list_sessions():
    return jsonify({"sessions": session_history[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_calls), "sessions": len(session_history)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
