#!/usr/bin/env python3
"""Click-to-Call WebRTC with AI Assist — browser-based calling with real-time AI coaching sidebar."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template_string
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
WEBRTC_CREDENTIAL_ID = os.getenv("WEBRTC_CREDENTIAL_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

CLICK_TO_CALL_HTML = """<!DOCTYPE html>
<html><head><title>Click to Call</title>
<style>
body{font-family:system-ui;margin:2rem;background:#111;color:#eee}
.panel{display:flex;gap:2rem} .call-panel,.ai-panel{flex:1;border:1px solid #333;padding:1rem;border-radius:8px}
button{background:#22c55e;color:white;border:none;padding:0.8rem 1.5rem;border-radius:6px;cursor:pointer;font-size:1rem}
button:hover{background:#16a34a} button.end{background:#ef4444} input{padding:0.5rem;width:200px;border-radius:4px;border:1px solid #555;background:#222;color:#eee}
.coaching{background:#1a1a2e;padding:0.5rem;margin:0.3rem 0;border-radius:4px;border-left:3px solid #22c55e}
</style></head><body>
<h1>Click to Call with AI Assist</h1>
<div class="panel">
<div class="call-panel">
<h2>Call</h2>
<input type="tel" id="number" placeholder="+1234567890">
<button onclick="startCall()">Call</button>
<button class="end" onclick="endCall()">Hang Up</button>
<p id="status">Ready</p>
</div>
<div class="ai-panel">
<h2>AI Coaching</h2>
<div id="coaching">AI suggestions will appear here during the call...</div>
</div></div>
<script>
function startCall(){document.getElementById('status').textContent='Calling...';}
function endCall(){document.getElementById('status').textContent='Ended';}
</script></body></html>"""

@app.route("/")
def index():
    return render_template_string(CLICK_TO_CALL_HTML)

@app.route("/webrtc/token", methods=["POST"])
def get_token():
    try:
        resp = requests.post("https://api.telnyx.com/v2/telephony_credentials", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"connection_id": os.getenv("CONNECTION_ID")}, timeout=10)
        if resp.ok:
            return jsonify(resp.json().get("data", {})), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Failed to create credential"}), 500

@app.route("/coaching", methods=["POST"])
def get_coaching():
    data = request.get_json()
    transcript = data.get("transcript", "")
    msgs = [{"role": "system", "content": "You are a real-time sales coach. Based on the call transcript, give one actionable coaching tip. Be specific and brief."},
        {"role": "user", "content": transcript}]
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": msgs, "max_tokens": 100, "temperature": 0.5}, timeout=10)
    resp.raise_for_status()
    tip = resp.json()["choices"][0]["message"]["content"]
    return jsonify({"coaching_tip": tip}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
