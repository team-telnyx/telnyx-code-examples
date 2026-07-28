#!/usr/bin/env python3
"""AI Voicemail Transcription & Forwarding — voicemail to AI-summarized SMS/email with priority classification."""

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
FORWARD_NUMBER = os.getenv("FORWARD_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

voicemails = []
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


def call_inference(messages, max_tokens=300):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def classify_and_summarize(transcript, caller):
    messages = [{"role": "system", "content": "Analyze this voicemail. Return JSON: priority (urgent/normal/spam), summary (one sentence), callback_needed (boolean), category (sales/support/personal/automated), caller_sentiment (positive/neutral/negative)."},
        {"role": "user", "content": f"From: {caller}\nTranscript: {transcript}"}]
    return call_inference(messages)

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": to, "to": FORWARD_NUMBER, "text": text}, timeout=10)
    except requests.RequestException as e:
        app.logger.error("SMS forward failed: %s", e)

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

    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[ccid] = {"caller": p.get("from", "unknown"), "transcript": []}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        # Try to connect to primary number first, if no answer -> voicemail
        client.calls.actions.speak(ccid, payload="Hi, I'm not available right now. Please leave a message after the beep and I'll get back to you.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended":
        client.calls.actions.start_recording(ccid, format="mp3", channels="single", play_beep=True)
        client.calls.actions.start_transcription(ccid, language="en")
        return jsonify({"status": "recording"}), 200
    elif event_type == "call.transcription":
        text = p.get("transcription_data", {}).get("transcript", "")
        if text and ccid in active_calls:
            active_calls[ccid]["transcript"].append(text)
        return jsonify({"status": "transcribing"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and call["transcript"]:
            full_transcript = " ".join(call["transcript"])
            try:
                analysis_json = classify_and_summarize(full_transcript, call["caller"])
                analysis = json.loads(analysis_json)
                voicemail = {"caller": call["caller"], "transcript": full_transcript, "analysis": analysis}
                voicemails.append(voicemail)
                priority = analysis.get("priority", "normal")
                summary = analysis.get("summary", full_transcript[:100])
                emoji = {"urgent": "🚨", "normal": "📞", "spam": "🗑️"}.get(priority, "📞")
                sms_text = f"{emoji} Voicemail from {call['caller']}\nPriority: {priority}\n{summary}"
                if analysis.get("callback_needed"):
                    sms_text += "\n⬆️ Callback requested"
                send_sms(call["caller"], sms_text)
            except Exception as e:
                app.logger.error("Analysis failed: %s", e)
                send_sms(call["caller"], f"📞 New voicemail from {call['caller']}: {full_transcript[:200]}")
        return jsonify({"status": "processed"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/voicemails", methods=["GET"])
def list_voicemails():
    return jsonify({"voicemails": voicemails[-50:], "total": len(voicemails)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "voicemails": len(voicemails)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
