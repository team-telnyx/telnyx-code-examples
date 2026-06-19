#!/usr/bin/env python3
"""Verify Multi-Channel Auth — multi-channel verification: SMS first, fallback to voice call, then WhatsApp. Cascading 2FA."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
verifications = {}

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

_start_ttl_cleanup(verifications)


CHANNELS = ["sms", "call", "whatsapp"]

@app.route("/verify/start", methods=["POST"])
def start_verification():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    channel = data.get("channel", "sms")
    if not phone:
        return jsonify({"error": "phone_number required"}), 400
    try:
        resp = requests.post(f"{API}/verifications", headers=headers,
            json={"phone_number": phone, "type": channel,
                "timeout_secs": data.get("timeout", 300)})
        result = resp.json()
        vid = result.get("data", {}).get("id", f"V-{int(time.time())}")
        verifications[vid] = {"id": vid, "phone": phone, "channel": channel,
            "status": "pending", "attempts": [channel],
            "started": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        return jsonify({"verification_id": vid, "channel": channel, "result": result}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to start verification")
        return jsonify({"error": "could not start verification"}), 500

@app.route("/verify/check", methods=["POST"])
def check_verification():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    vid = data.get("verification_id")
    code = data.get("code")
    v = verifications.get(vid)
    if not v:
        return jsonify({"error": "Verification not found"}), 404
    try:
        resp = requests.post(f"{API}/verifications/{vid}/actions/verify", headers=headers,
            json={"code": code}, timeout=15)
        result = resp.json()
        verified = result.get("data", {}).get("status") == "accepted"
        if verified:
            v["status"] = "verified"
            return jsonify({"verified": True, "channel": v["channel"]}), 200
        else:
            v["status"] = "failed"
            return jsonify({"verified": False, "message": "Invalid code"}), 200
    except Exception as e:
        app.logger.exception("Failed to check verification")
        return jsonify({"error": "could not check verification"}), 500

@app.route("/verify/escalate/<vid>", methods=["POST"])
def escalate_channel(vid):
    v = verifications.get(vid)
    if not v:
        return jsonify({"error": "Verification not found"}), 404
    current_idx = CHANNELS.index(v["channel"]) if v["channel"] in CHANNELS else -1
    if current_idx >= len(CHANNELS) - 1:
        return jsonify({"error": "No more channels to try"}), 400
    next_channel = CHANNELS[current_idx + 1]
    try:
        resp = requests.post(f"{API}/verifications", headers=headers,
            json={"phone_number": v["phone"], "type": next_channel, "timeout_secs": 300}, timeout=15)
        result = resp.json()
        new_vid = result.get("data", {}).get("id", f"V-{int(time.time())}")
        v["channel"] = next_channel
        v["attempts"].append(next_channel)
        v["status"] = "pending"
        verifications[new_vid] = v
        return jsonify({"verification_id": new_vid, "channel": next_channel,
            "attempt": len(v["attempts"])}), 200
    except Exception as e:
        app.logger.exception("Failed to escalate verification channel")
        return jsonify({"error": "could not escalate verification"}), 500

@app.route("/verify/cascade", methods=["POST"])
def cascade_verify():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    return jsonify({"phone": phone,
        "flow": "1) SMS code sent → 2) If no response in 60s, voice call → 3) If unreachable, WhatsApp",
        "start_url": "/verify/start", "check_url": "/verify/check", "escalate_url": "/verify/escalate/<id>"}), 200

@app.route("/verifications", methods=["GET"])
def list_verifications():
    return jsonify({"verifications": list(verifications.values())[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "verifications": len(verifications)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
