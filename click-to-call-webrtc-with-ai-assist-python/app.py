#!/usr/bin/env python3
"""Click-to-Call WebRTC with AI Assist — browser-based calling with real-time AI coaching sidebar."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
WEBRTC_CONNECTION_ID = os.getenv("WEBRTC_CONNECTION_ID", "")
CALLER_NUMBER = os.getenv("CALLER_NUMBER", "+16188939137")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/webrtc/token", methods=["POST"])
def get_token():
    try:
        resp = requests.post("https://api.telnyx.com/v2/telephony_credentials",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"connection_id": WEBRTC_CONNECTION_ID, "expires_at": "2027-01-01T00:00:00Z"},
            timeout=10)
        if resp.ok:
            data = resp.json().get("data", {})
            return jsonify({
                "sip_username": data.get("sip_username", ""),
                "sip_password": data.get("sip_password", ""),
                "caller_number": CALLER_NUMBER
            }), 200
        return jsonify({"error": "Telnyx API error", "status": resp.status_code}), 502
    except Exception as e:
        app.logger.exception("Failed to create WebRTC telephony credential")
        return jsonify({"error": str(e)}), 500

@app.route("/coaching", methods=["POST"])
def get_coaching():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    transcript = data.get("transcript", "")
    if len(transcript) < 20:
        return jsonify({"error": "transcript too short"}), 400
    msgs = [
        {"role": "system", "content": "You are a real-time sales coach listening to a phone call. Based on the transcript excerpt, give ONE actionable coaching tip. Be specific, brief (2 sentences max), and practical. Focus on tone, clarity, objection handling, or next steps."},
        {"role": "user", "content": transcript[-500:]}
    ]
    try:
        resp = requests.post(INFERENCE_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"model": AI_MODEL, "messages": msgs, "max_tokens": 200, "temperature": 0.5},
            timeout=30)
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]
        tip = msg.get("content") or msg.get("reasoning", "")
        return jsonify({"coaching_tip": tip}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "uptime_seconds": int(time.time() - START_TIME)}), 200

START_TIME = time.time()

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
