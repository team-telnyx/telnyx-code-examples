#!/usr/bin/env python3
"""Webhook Debugger AI Assistant — catch, inspect, and debug Telnyx webhooks with AI explanations."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
webhook_log = []

def call_inference(messages, max_tokens=300):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/catch/<path:subpath>", methods=["GET", "POST", "PUT", "DELETE"])
def catch_webhook(subpath=""):
    entry = {"method": request.method, "path": f"/catch/{subpath}", "headers": dict(request.headers),
        "body": request.get_json(silent=True) or request.data.decode("utf-8", errors="replace")[:5000],
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "query": dict(request.args)}
    webhook_log.append(entry)
    if len(webhook_log) > 500:
        webhook_log.pop(0)
    return jsonify({"status": "caught", "id": len(webhook_log) - 1}), 200

@app.route("/analyze/<int:index>", methods=["GET"])
def analyze_webhook(index):
    if index >= len(webhook_log):
        return jsonify({"error": "Not found"}), 404
    entry = webhook_log[index]
    messages = [{"role": "system", "content": "You are a Telnyx webhook expert. Analyze this webhook payload and explain: what event occurred, what you should do in response, common mistakes, and example response code."},
        {"role": "user", "content": json.dumps(entry, default=str)}]
    analysis = call_inference(messages)
    return jsonify({"webhook": entry, "analysis": analysis}), 200

@app.route("/analyze/recent", methods=["GET"])
def analyze_recent():
    if not webhook_log:
        return jsonify({"error": "No webhooks captured yet"}), 404
    recent = webhook_log[-5:]
    messages = [{"role": "system", "content": "Analyze these recent Telnyx webhooks. Identify patterns, potential issues, and suggest improvements."},
        {"role": "user", "content": json.dumps(recent, default=str)}]
    analysis = call_inference(messages, max_tokens=500)
    return jsonify({"recent_count": len(recent), "analysis": analysis}), 200

@app.route("/log", methods=["GET"])
def view_log():
    return jsonify({"webhooks": webhook_log[-50:], "total": len(webhook_log)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "webhooks_captured": len(webhook_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
