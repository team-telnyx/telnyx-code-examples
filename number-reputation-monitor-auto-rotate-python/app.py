#!/usr/bin/env python3
"""Number Reputation Monitor — track outbound number reputation, auto-rotate flagged numbers."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
number_health = {}  # number -> {calls, complaints, answer_rate, flagged}
rotation_log = []

def get_numbers():
    try:
        resp = requests.get("https://api.telnyx.com/v2/phone_numbers", headers={"Authorization": f"Bearer {TELNYX_API_KEY}"}, params={"page[size]": 100}, timeout=15)
        if resp.ok:
            return resp.json().get("data", [])
    except Exception:
        pass
    return []

def analyze_health(number_data):
    messages = [{"role": "system", "content": "Analyze phone number health metrics. Return JSON: risk_level (healthy/warning/critical), recommendation (keep/rotate/retire), reasoning (string)."},
        {"role": "user", "content": json.dumps(number_data)}]
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": 150, "temperature": 0.2}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/scan", methods=["POST"])
def scan_numbers():
    numbers = get_numbers()
    results = []
    for num in numbers[:20]:
        phone = num.get("phone_number", "")
        health = number_health.get(phone, {"calls": 0, "complaints": 0, "answer_rate": 0.5})
        try:
            analysis = json.loads(analyze_health({**health, "number": phone}))
            number_health[phone] = {**health, "analysis": analysis, "last_scan": time.time()}
            if analysis.get("recommendation") == "rotate":
                rotation_log.append({"number": phone, "reason": analysis.get("reasoning", "flagged"), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
            results.append({"number": phone, "analysis": analysis})
        except Exception:
            results.append({"number": phone, "analysis": {"risk_level": "unknown"}})
    return jsonify({"scanned": len(results), "results": results}), 200

@app.route("/health-report", methods=["GET"])
def health_report():
    return jsonify({"numbers": number_health, "rotations": rotation_log[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "numbers_tracked": len(number_health), "rotations": len(rotation_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
