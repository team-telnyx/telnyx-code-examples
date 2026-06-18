#!/usr/bin/env python3
"""AI Voice Survey Sentiment Tracker — real-time CSAT scoring from voice tone and word choice."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
SURVEY_NUMBER = os.getenv("SURVEY_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_surveys = {}
survey_results = []

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    survey = active_surveys.get(ccid)
    if event_type == "call.initiated" and data.get("direction") == "incoming":
        active_surveys[ccid] = {"caller": data.get("from"), "responses": [], "sentiment_scores": []}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Thanks for calling! We'd love your feedback. In a few words, how was your recent experience with us?", voice="female", language_code="en-US")
        return jsonify({"status": "asking"}), 200
    elif event_type == "call.speak.ended" and survey:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and survey:
        speech = data.get("speech", {}).get("result", "")
        if speech:
            survey["responses"].append(speech)
            msgs = [{"role": "system", "content": "Analyze sentiment. Return JSON: sentiment (0.0-1.0), emotion (happy/neutral/frustrated/angry), key_topic (string)."},
                {"role": "user", "content": speech}]
            try:
                analysis = json.loads(call_inference(msgs, max_tokens=100))
                survey["sentiment_scores"].append(analysis)
            except Exception:
                pass
            if len(survey["responses"]) < 3:
                follow_ups = ["What specifically stood out to you?", "Is there anything we could improve?", "On a scale of 1 to 10, how likely are you to recommend us?"]
                client.calls.actions.speak(ccid, payload=follow_ups[len(survey["responses"]) - 1], voice="female", language_code="en-US")
            else:
                client.calls.actions.speak(ccid, payload="Thank you so much for your feedback! It really helps us improve. Have a great day!", voice="female", language_code="en-US")
        return jsonify({"status": "processing"}), 200
    elif event_type == "call.hangup":
        survey = active_surveys.pop(ccid, None)
        if survey and survey["responses"]:
            survey_results.append({"caller": survey["caller"], "responses": survey["responses"], "sentiments": survey["sentiment_scores"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/results", methods=["GET"])
def get_results():
    return jsonify({"results": survey_results[-50:], "total": len(survey_results)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_surveys), "completed": len(survey_results)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
