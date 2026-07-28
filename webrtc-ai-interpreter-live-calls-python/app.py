#!/usr/bin/env python3
"""WebRTC AI Interpreter for Live Calls — real-time translation between two callers speaking different languages."""
import os, json, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
interpreted_calls = {}

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

_start_ttl_cleanup(interpreted_calls)


def translate(text, from_lang, to_lang):
    messages = [{"role": "system", "content": f"Translate from {from_lang} to {to_lang}. Return only the translation. Keep it natural and conversational for a phone call."},
        {"role": "user", "content": text}]
    try:
        resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": 200, "temperature": 0.3}, timeout=10)
    except Exception as e:
        app.logger.error("Request failed: %s", e)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/interpret", methods=["POST"])
def start_interpreted_call():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    caller_a = data.get("caller_a", {})
    caller_b = data.get("caller_b", {})
    return jsonify({"status": "configured", "note": "AI interpreter bridges calls with real-time translation via transcription + TTS"}), 200

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
    call = interpreted_calls.get(ccid)
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        interpreted_calls[ccid] = {"caller": p.get("from"), "lang_a": "en", "lang_b": "es", "transcript": []}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="AI interpreter connected. I will translate between English and Spanish. Go ahead and speak.", voice="female", language_code="en-US")
        return jsonify({"status": "ready"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.start_transcription(ccid, language="en")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.transcription" and call:
        text = p.get("transcription_data", {}).get("transcript", "")
        if text:
            translated = translate(text, call["lang_a"], call["lang_b"])
            call["transcript"].append({"original": text, "translated": translated})
            client.calls.actions.speak(ccid, payload=translated, voice="female", language_code="es-ES")
        return jsonify({"status": "translating"}), 200
    elif event_type == "call.hangup":
        interpreted_calls.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(interpreted_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
