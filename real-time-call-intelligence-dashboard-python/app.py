#!/usr/bin/env python3
"""Real-Time Call Intelligence Dashboard — live transcription, sentiment analysis, and competitor detection."""

import os
import json
import time
import threading
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template_string

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Active call intelligence
call_intel = {}  # call_control_id -> {transcript, sentiment_scores, competitor_mentions, alerts}

COMPETITORS = ["twilio", "vonage", "bandwidth", "plivo", "sinch", "infobip", "messagebird"]

DASHBOARD_HTML = """<!DOCTYPE html>
<html><head><title>Call Intelligence Dashboard</title>
<style>
body{font-family:system-ui;margin:2rem;background:#0a0a0a;color:#e0e0e0}
.call{border:1px solid #333;padding:1rem;margin:1rem 0;border-radius:8px}
.hot{border-color:#ff4444} .warm{border-color:#ffaa00} .cool{border-color:#44ff44}
.sentiment{font-size:2rem;float:right}
.alert{background:#ff4444;color:white;padding:0.5rem;border-radius:4px;margin:0.3rem 0}
h1{color:#fff} h3{margin:0}
</style>
<script>setTimeout(()=>location.reload(),5000)</script>
</head><body>
<h1>Live Call Intelligence</h1>
<p>Active calls: {{calls|length}} | Auto-refresh: 5s</p>
{% for cid, c in calls.items() %}
<div class="call {{'hot' if c.avg_sentiment < 0.3 else 'warm' if c.avg_sentiment < 0.6 else 'cool'}}">
<div class="sentiment">{{'😡' if c.avg_sentiment < 0.3 else '😐' if c.avg_sentiment < 0.6 else '😊'}}</div>
<h3>{{c.from_number}} → {{c.to_number}}</h3>
<p>Duration: {{c.duration}}s | Sentiment: {{c.avg_sentiment|round(2)}}</p>
{% for a in c.alerts %}<div class="alert">⚠️ {{a}}</div>{% endfor %}
<p><em>Latest: {{c.latest_text}}</em></p>
</div>
{% endfor %}
</body></html>"""


def analyze_segment(text):
    """Analyze a transcript segment for sentiment and signals."""
    messages = [
        {"role": "system", "content": (
            "Analyze this call segment. Return JSON: "
            "sentiment (0.0-1.0, 0=negative, 1=positive), "
            "competitor_mentioned (string or null), "
            "objection_detected (boolean), "
            "buying_signal (boolean), "
            "suggested_response (string or null — coaching tip for the rep if sentiment is low or objection detected)."
        )},
        {"role": "user", "content": text},
    ]
    try:
        resp = requests.post(
            INFERENCE_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"model": AI_MODEL, "messages": messages, "max_tokens": 200, "temperature": 0.2},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle voice events with real-time intelligence."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})

    if event_type == "call.initiated" and data.get("direction") == "incoming":
        call_intel[call_control_id] = {
            "from_number": data.get("from", "unknown"),
            "to_number": data.get("to", "unknown"),
            "transcript": [],
            "sentiment_scores": [],
            "avg_sentiment": 0.5,
            "competitor_mentions": [],
            "alerts": [],
            "latest_text": "",
            "start_time": time.time(),
            "duration": 0,
        }
        client.calls.actions.answer(call_control_id)
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        client.calls.actions.transcription_start(call_control_id, language="en")
        return jsonify({"status": "transcribing"}), 200

    elif event_type == "call.transcription":
        text = data.get("transcription_data", {}).get("transcript", "")
        if text and call_control_id in call_intel:
            ci = call_intel[call_control_id]
            ci["transcript"].append(text)
            ci["latest_text"] = text
            ci["duration"] = int(time.time() - ci["start_time"])

            # Check for competitor mentions
            for comp in COMPETITORS:
                if comp in text.lower() and comp not in ci["competitor_mentions"]:
                    ci["competitor_mentions"].append(comp)
                    ci["alerts"].append(f"Competitor mentioned: {comp}")

            # Analyze every 3 segments to avoid excessive API calls
            if len(ci["transcript"]) % 3 == 0:
                analysis = analyze_segment(" ".join(ci["transcript"][-3:]))
                if analysis:
                    try:
                        result = json.loads(analysis)
                        ci["sentiment_scores"].append(result.get("sentiment", 0.5))
                        ci["avg_sentiment"] = sum(ci["sentiment_scores"]) / len(ci["sentiment_scores"])
                        if result.get("suggested_response"):
                            ci["alerts"].append(f"Coach: {result['suggested_response']}")
                        if result.get("buying_signal"):
                            ci["alerts"].append("Buying signal detected")
                    except (json.JSONDecodeError, KeyError):
                        pass
        return jsonify({"status": "analyzed"}), 200

    elif event_type == "call.hangup":
        ended = call_intel.pop(call_control_id, None)
        if ended:
            app.logger.info(f"Call ended: {ended['from_number']}, sentiment avg: {ended['avg_sentiment']:.2f}")
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/dashboard", methods=["GET"])
def dashboard():
    """Live manager dashboard showing all active calls."""
    return render_template_string(DASHBOARD_HTML, calls=call_intel)


@app.route("/api/calls", methods=["GET"])
def api_calls():
    """JSON API for active call intelligence."""
    return jsonify(call_intel), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_calls": len(call_intel)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
