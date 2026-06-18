#!/usr/bin/env python3
"""AI Competitive Win/Loss Call Analyzer — analyze recorded sales calls for competitive intelligence."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
analyses = []

def call_inference(messages, max_tokens=600):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/analyze", methods=["POST"])
def analyze_call():
    data = request.get_json()
    transcript = data.get("transcript", "")
    outcome = data.get("outcome", "unknown")
    if not transcript:
        return jsonify({"error": "transcript required"}), 400
    msgs = [{"role": "system", "content": "Analyze this sales call for competitive intelligence. Return JSON: outcome (won/lost/pending), competitors_mentioned (list), competitor_strengths_cited (list of {competitor, strength}), competitor_weaknesses_cited (list of {competitor, weakness}), our_strengths (list), our_weaknesses (list), price_discussed (boolean), price_objection (boolean), decision_factors (list ranked by importance), rep_performance (1-10), win_loss_reason (string), recommendation (string for future calls)."},
        {"role": "user", "content": f"Outcome: {outcome}\n\nTranscript:\n{transcript}"}]
    analysis = call_inference(msgs)
    try:
        result = json.loads(analysis)
    except json.JSONDecodeError:
        result = {"raw": analysis}
    result["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    analyses.append(result)
    return jsonify(result), 200

@app.route("/insights", methods=["GET"])
def get_insights():
    if not analyses:
        return jsonify({"error": "No analyses yet"}), 404
    msgs = [{"role": "system", "content": "Synthesize competitive intelligence from multiple call analyses. Return JSON: top_competitors (list), most_common_objections (list), win_patterns (list), loss_patterns (list), pricing_trends (string), recommendations (list)."},
        {"role": "user", "content": json.dumps(analyses[-20:])}]
    insights = call_inference(msgs, max_tokens=500)
    return jsonify({"total_calls": len(analyses), "insights": insights}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "analyses": len(analyses)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
