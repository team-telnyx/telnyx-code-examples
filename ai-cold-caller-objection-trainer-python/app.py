#!/usr/bin/env python3
"""AI Cold Caller Objection Trainer — practice handling sales objections with AI-generated scenarios."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
TRAINER_NUMBER = os.getenv("TRAINER_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
training_sessions = {}
session_results = []

PERSONAS = [
    {"name": "Busy VP", "style": "Impatient, 30 seconds max, says 'I'm busy' immediately. Only engaged by specific ROI numbers."},
    {"name": "Happy Incumbent", "style": "Already uses competitor, satisfied. Needs compelling switch reason. Will compare everything to current vendor."},
    {"name": "Budget Blocker", "style": "Interested but 'no budget until next quarter.' Tests if rep can create urgency without being pushy."},
    {"name": "Technical Skeptic", "style": "Deep technical questions, doubts claims, wants proof points and benchmarks. Respects competence."},
    {"name": "Gatekeeper", "style": "Executive assistant. Protective of boss's time. Only passes through compelling, specific value props."},
]

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.8}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/train", methods=["POST"])
def start_training():
    data = request.get_json()
    rep_number = data.get("rep_number")
    persona_index = data.get("persona", 0)
    persona = PERSONAS[persona_index % len(PERSONAS)]
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": rep_number, "from": TRAINER_NUMBER, "connection_id": CONNECTION_ID}, timeout=10)
        ccid = resp.json().get("data", {}).get("call_control_id")
        if ccid:
            training_sessions[ccid] = {"rep": rep_number, "persona": persona, "conversation": [
                {"role": "system", "content": f"You are {persona['name']}. {persona['style']} The caller is a sales rep practicing cold calling. Stay in character. Be realistic. After 5-8 exchanges, break character briefly to give coaching feedback."}
            ], "start_time": time.time()}
        return jsonify({"status": "calling", "persona": persona["name"]}), 200
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    session = training_sessions.get(ccid)
    if event_type == "call.answered" and session:
        persona = session["persona"]
        opening = call_inference(session["conversation"] + [{"role": "user", "content": "The phone is ringing and you just picked up. Give your opening line in character."}])
        session["conversation"].append({"role": "assistant", "content": opening})
        client.calls.actions.speak(ccid, payload=opening, voice="male", language_code="en-US")
        return jsonify({"status": "in_character"}), 200
    elif event_type == "call.speak.ended" and session:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and session:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="Hello? Are you still there?", voice="male", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        session["conversation"].append({"role": "user", "content": speech})
        response = call_inference(session["conversation"])
        session["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="male", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        session = training_sessions.pop(ccid, None)
        if session:
            duration = int(time.time() - session["start_time"])
            score_msgs = [{"role": "system", "content": "Score this sales training call. Return JSON: score (1-10), strengths (list), weaknesses (list), specific_feedback (string), objection_handling (1-10), rapport_building (1-10)."},
                {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in session["conversation"] if m["role"] != "system")}]
            try:
                score = call_inference(score_msgs, max_tokens=300)
                session_results.append({"rep": session["rep"], "persona": session["persona"]["name"], "duration": duration, "score": json.loads(score)})
            except Exception:
                session_results.append({"rep": session["rep"], "persona": session["persona"]["name"], "duration": duration})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/results", methods=["GET"])
def get_results():
    return jsonify({"sessions": session_results[-50:]}), 200

@app.route("/personas", methods=["GET"])
def list_personas():
    return jsonify({"personas": [{"index": i, "name": p["name"], "style": p["style"]} for i, p in enumerate(PERSONAS)]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(training_sessions), "completed": len(session_results)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
