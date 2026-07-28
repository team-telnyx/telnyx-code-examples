#!/usr/bin/env python3
"""Media Stream Live Transcription — fork call audio to WebSocket for real-time transcription display."""
import os, json, time, asyncio, threading, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
STREAM_NUMBER = os.getenv("STREAM_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
active_streams = {}
transcripts = {}

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

_start_ttl_cleanup(active_streams, transcripts)


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
        active_streams[ccid] = {"caller": p.get("from"), "started": time.time()}
        transcripts[ccid] = []
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.start_transcription(ccid, language="en")
        client.calls.actions.speak(ccid, payload="This call is being transcribed in real time. Go ahead and speak.", voice="female", language_code="en-US")
        return jsonify({"status": "streaming"}), 200
    elif event_type == "call.transcription":
        text = p.get("transcription_data", {}).get("transcript", "")
        if text and ccid in transcripts:
            transcripts[ccid].append({"text": text, "time": time.time()})
        return jsonify({"status": "ok"}), 200
    elif event_type == "call.hangup":
        active_streams.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/transcripts/<ccid>", methods=["GET"])
def get_transcript(ccid):
    t = transcripts.get(ccid)
    if t is None: return jsonify({"error": "Not found"}), 404
    return jsonify({"transcript": t}), 200

@app.route("/transcripts", methods=["GET"])
def list_transcripts():
    return jsonify({"active": list(active_streams.keys()), "completed": [k for k in transcripts if k not in active_streams]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_streams), "transcripts": len(transcripts)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
