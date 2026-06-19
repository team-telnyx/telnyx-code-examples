#!/usr/bin/env python3
"""Media Stream Custom Audio Mixer — mix custom audio into live calls via WebSocket-based media streaming."""
import os, json, time, base64, asyncio, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
API = "https://api.telnyx.com/v2"
import threading, time as _ttl_time
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
active_streams = {}

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

_start_ttl_cleanup(active_streams)

stream_log = []

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
        try:
            requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
        except Exception:
            pass
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        try:
            requests.post(f"{API}/calls/{ccid}/actions/streaming_start", headers=headers,
                json={"stream_url": os.getenv("STREAM_WEBSOCKET_URL", "wss://your-server/stream", timeout=10),
                    "stream_track": "both_tracks", "enable_dialogflow": False}, timeout=10)
            active_streams[ccid] = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "streaming"}
        except Exception:
            app.logger.exception("Failed to start media streaming")
            return jsonify({"error": "could not start streaming"}), 500
        return jsonify({"status": "streaming_started"}), 200
    elif event_type == "streaming.started":
        stream_log.append({"call_id": ccid, "event": "started", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"status": "ok"}), 200
    elif event_type == "streaming.stopped":
        active_streams.pop(ccid, None)
        stream_log.append({"call_id": ccid, "event": "stopped", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"status": "ok"}), 200
    elif event_type == "call.hangup":
        if ccid in active_streams:
            try:
                requests.post(f"{API}/calls/{ccid}/actions/streaming_stop", headers=headers, json={}, timeout=10)
            except Exception:
                pass
            active_streams.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/streams/<ccid>/inject", methods=["POST"])
def inject_audio(ccid):
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    audio_url = data.get("audio_url")
    if audio_url:
        try:
            requests.post(f"{API}/calls/{ccid}/actions/playback_start", headers=headers,
                json={"audio_url": audio_url, "overlay": data.get("overlay", True)}, timeout=10)
            return jsonify({"status": "injecting", "audio": audio_url}), 200
        except Exception:
            app.logger.exception("Failed to inject audio")
            return jsonify({"error": "could not inject audio"}), 500
    return jsonify({"error": "audio_url required"}), 400

@app.route("/streams", methods=["GET"])
def list_streams():
    return jsonify({"active_streams": active_streams, "count": len(active_streams)}), 200

@app.route("/stream-log", methods=["GET"])
def get_log():
    return jsonify({"log": stream_log[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_streams": len(active_streams)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
