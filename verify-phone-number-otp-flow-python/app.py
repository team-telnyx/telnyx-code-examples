#!/usr/bin/env python3
"""Verify Phone Number OTP Flow — Telnyx Verify API with SMS primary and voice call fallback."""
import os, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
VERIFY_PROFILE_ID = os.getenv("VERIFY_PROFILE_ID")
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


@app.route("/verify/start", methods=["POST"])
def start_verification():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    if not phone:
        return jsonify({"error": "phone_number required"}), 400
    try:
        resp = requests.post("https://api.telnyx.com/v2/verifications", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"phone_number": phone, "verify_profile_id": VERIFY_PROFILE_ID, "type": "sms"}, timeout=10)
        if resp.ok:
            verifications[phone] = {"status": "pending", "started": time.time()}
            return jsonify({"status": "sent", "phone": phone}), 200
        return jsonify({"error": resp.text}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to start verification")
        return jsonify({"error": "could not start verification"}), 500

@app.route("/verify/voice-fallback", methods=["POST"])
def voice_fallback():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    try:
        resp = requests.post("https://api.telnyx.com/v2/verifications", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"phone_number": phone, "verify_profile_id": VERIFY_PROFILE_ID, "type": "call"}, timeout=10)
        return jsonify({"status": "voice_sent" if resp.ok else "failed"}), 200 if resp.ok else 500
    except Exception as e:
        app.logger.exception("Failed to send voice fallback")
        return jsonify({"error": "could not send voice fallback"}), 500

@app.route("/verify/check", methods=["POST"])
def check_verification():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    code = data.get("code")
    try:
        resp = requests.post("https://api.telnyx.com/v2/verifications/by_phone_number/" + phone + "/actions/verify",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"code": code, "verify_profile_id": VERIFY_PROFILE_ID}, timeout=10)
        if resp.ok:
            verifications[phone] = {"status": "verified", "verified_at": time.time()}
            return jsonify({"status": "verified"}), 200
        return jsonify({"status": "invalid_code"}), 400
    except Exception as e:
        app.logger.exception("Failed to check verification")
        return jsonify({"error": "could not verify code"}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "verifications": len(verifications)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
