#!/usr/bin/env python3
"""SIM Fleet Data Usage Anomaly Detector — monitor IoT SIM usage, AI detects anomalies, SMS alerts."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

anomalies = []

def get_sim_usage():
    try:
        resp = requests.get("https://api.telnyx.com/v2/sim_cards", headers={"Authorization": f"Bearer {TELNYX_API_KEY}"})
        if resp.ok:
            return resp.json().get("data", [])
    except Exception:
        pass
    return []

def analyze_usage(sims_data):
    messages = [{"role": "system", "content": "Analyze IoT SIM usage data for anomalies. Look for: sudden spikes, unusual patterns, SIMs using 10x normal data, offline SIMs that should be online. Return JSON array of anomalies: [{sim_id, issue, severity (low/medium/high), recommendation}]"},
        {"role": "user", "content": json.dumps(sims_data[:50])}]
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": 500, "temperature": 0.2}, timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_alert(text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": ALERT_NUMBER, "to": ALERT_NUMBER, "text": text}, timeout=10)
    except Exception as e:
        app.logger.error("Alert failed: %s", e)

@app.route("/scan", methods=["POST"])
def scan_fleet():
    sims = get_sim_usage()
    if not sims:
        return jsonify({"error": "No SIM data available"}), 404
    try:
        result_json = analyze_usage(sims)
        found = json.loads(result_json) if isinstance(result_json, str) else result_json
        if isinstance(found, list) and found:
            for anomaly in found:
                anomalies.append({**anomaly, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
                if anomaly.get("severity") in ("medium", "high"):
                    send_alert(f"SIM Anomaly [{anomaly.get('severity', '').upper()}]: {anomaly.get('sim_id', 'unknown')} - {anomaly.get('issue', 'anomaly detected')}")
            return jsonify({"anomalies_found": len(found), "details": found}), 200
        return jsonify({"anomalies_found": 0, "message": "Fleet looks healthy"}), 200
    except Exception as e:
        app.logger.exception("Fleet scan failed")
        return jsonify({"error": "fleet scan failed"}), 500

@app.route("/anomalies", methods=["GET"])
def list_anomalies():
    return jsonify({"anomalies": anomalies[-100:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "anomalies_detected": len(anomalies)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
