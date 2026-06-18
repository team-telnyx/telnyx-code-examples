#!/usr/bin/env python3
"""Multi-Language Customer Survey — outbound voice surveys in the caller's language with AI analysis."""

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

survey_queue = []
active_surveys = {}
results = []

SURVEY_QUESTIONS = [
    "On a scale of 1 to 10, how satisfied are you with our service?",
    "What could we do to improve your experience?",
    "Would you recommend us to a colleague?",
]

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def translate_question(question, language):
    if language == "en":
        return question
    messages = [{"role": "system", "content": f"Translate to {language}. Return only the translation, nothing else."},
        {"role": "user", "content": question}]
    return call_inference(messages, max_tokens=100)

@app.route("/survey/start", methods=["POST"])
def start_survey():
    data = request.get_json()
    contacts = data.get("contacts", [])
    for contact in contacts:
        if "number" in contact:
            survey_queue.append(contact)
    if survey_queue:
        contact = survey_queue.pop(0)
        try:
            resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                json={"to": contact["number"], "from": SURVEY_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
            ccid = resp.json().get("data", {}).get("call_control_id")
            if ccid:
                lang = contact.get("language", "en")
                active_surveys[ccid] = {"contact": contact, "language": lang, "question_index": 0, "answers": []}
        except requests.RequestException as e:
            app.logger.error(f"Survey call failed: {e}")
    return jsonify({"queued": len(survey_queue)}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    survey = active_surveys.get(ccid)

    if event_type == "call.answered" and survey:
        lang = survey["language"]
        question = translate_question(SURVEY_QUESTIONS[0], lang) if lang != "en" else SURVEY_QUESTIONS[0]
        greeting = translate_question("Hi! We have a quick 3-question survey about your recent experience. ", lang) if lang != "en" else "Hi! We have a quick 3-question survey about your recent experience. "
        client.calls.actions.speak(ccid, payload=greeting + question, voice="female", language_code=f"{lang}-{lang.upper()}" if len(lang) == 2 else lang)
        return jsonify({"status": "asking"}), 200
    elif event_type == "call.speak.ended" and survey:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and survey:
        speech = data.get("speech", {}).get("result", "")
        if speech:
            survey["answers"].append({"question": SURVEY_QUESTIONS[survey["question_index"]], "answer": speech})
            survey["question_index"] += 1
            if survey["question_index"] < len(SURVEY_QUESTIONS):
                lang = survey["language"]
                next_q = translate_question(SURVEY_QUESTIONS[survey["question_index"]], lang) if lang != "en" else SURVEY_QUESTIONS[survey["question_index"]]
                client.calls.actions.speak(ccid, payload=next_q, voice="female", language_code="en-US")
            else:
                client.calls.actions.speak(ccid, payload="Thank you for your time! Your feedback helps us improve.", voice="female", language_code="en-US")
        else:
            client.calls.actions.speak(ccid, payload="I didn't catch that. Could you repeat your answer?", voice="female", language_code="en-US")
        return jsonify({"status": "processing"}), 200
    elif event_type == "call.hangup":
        survey = active_surveys.pop(ccid, None)
        if survey and survey["answers"]:
            analysis_msgs = [{"role": "system", "content": "Analyze survey responses. Return JSON: nps_score (1-10 or null), sentiment (positive/neutral/negative), key_feedback (string), would_recommend (boolean or null)."},
                {"role": "user", "content": json.dumps(survey["answers"])}]
            try:
                analysis = call_inference(analysis_msgs)
                results.append({"contact": survey["contact"], "answers": survey["answers"], "analysis": json.loads(analysis)})
            except Exception:
                results.append({"contact": survey["contact"], "answers": survey["answers"]})
        return jsonify({"status": "completed"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/survey/results", methods=["GET"])
def get_results():
    return jsonify({"results": results, "total": len(results)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "completed": len(results), "queued": len(survey_queue)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
