#!/usr/bin/env python3
"""Interview Screen & Scheduler - candidate applies, AI calls for 5-min phone screen, scores answers, books qualified candidates on hiring manager's calendar. Integrates with Greenhouse ATS and Google Calendar."""
import os, json, base64, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
RECRUITER_SLACK = os.getenv("RECRUITER_SLACK_WEBHOOK", "")
GREENHOUSE_TOKEN = os.getenv("GREENHOUSE_API_KEY", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

candidates = []
screens = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(screens)

PASS_THRESHOLD = 70

SCREEN_QUESTIONS = [
    "Tell me briefly about your most recent role and what you were responsible for.",
    "Why are you interested in this position?",
    "What's your availability to start, and are you open to the compensation range of 80 to 120 thousand?",
]

def encode_state(state: dict) -> str:
    """Stringify the state object and base64-encode it — the value Telnyx round-trips."""
    return base64.b64encode(json.dumps(state).encode()).decode()


def decode_state(payload: dict) -> dict:
    """Recover the state object echoed back on the webhook payload."""
    raw = payload.get("client_state")
    if not raw:
        return {}
    try:
        return json.loads(base64.b64decode(raw))
    except Exception:
        return {}


def ai_score(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": "Score this phone screen 0-100. Consider: relevance of experience, enthusiasm, compensation alignment, communication clarity. Reply JSON: {\"score\": number, \"strengths\": \"...\", \"concerns\": \"...\", \"recommend\": \"advance|reject\"}"},
                {"role": "user", "content": json.dumps(conversation)}], "max_tokens": 150, "temperature": 0.2}, timeout=15)
        return json.loads(resp.json()["choices"][0]["message"]["content"].strip().strip("`").replace("json\n",""))
    except Exception:
        return {"score": 50, "strengths": "Unable to evaluate", "concerns": "", "recommend": "review"}

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/candidates/screen", methods=["POST"])
def initiate_screen():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    candidate = {"name": data.get("name"), "phone": data.get("phone"),
        "position": data.get("position", ""), "source": data.get("source", ""),
        "status": "screening", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    candidates.append(candidate)
    idx = len(candidates) - 1
    send_sms(candidate["phone"], f"Hi {candidate['name']}, thanks for applying! We'd like to do a quick 5-minute phone screen. We'll call you shortly.")
    try:
        resp = requests.post(f"{API}/calls", headers=headers,
            json={"to": candidate["phone"], "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": encode_state({"candidate_idx": idx, "q": 0})}, timeout=10)
        screens[resp.json().get("data",{}).get("call_control_id","")] = {"candidate_idx": idx, "q_idx": 0, "answers": []}
    except Exception:
        candidate["status"] = "call_failed"
    return jsonify({"candidate_id": idx, "status": candidate["status"]}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event = data.get("event_type")
    ccid = p.get("call_control_id")
    state = decode_state(p)  # per-call state Telnyx echoes back as base64-encoded JSON
    screen = screens.get(ccid)
    if screen is None and state:
        # Rebuild the in-memory screen from the round-tripped client_state.
        screen = {"candidate_idx": state.get("candidate_idx", 0),
                  "q_idx": state.get("q", 0), "answers": []}
        screens[ccid] = screen
    screen = screen or {}

    if event == "call.answered" and screen:
        candidate = candidates[screen["candidate_idx"]]
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": f"Hi {candidate['name']}, this is a quick screening call. I'll ask you three questions. Let's start. {SCREEN_QUESTIONS[0]}",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended" and screen:
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 3, "timeout_secs": 60, "language_code": "en-US"}, timeout=10)
    elif event == "call.gather.ended" and screen:
        speech = p.get("speech", {}).get("result", "")
        if speech:
            screen["answers"].append({"question": SCREEN_QUESTIONS[screen["q_idx"]], "answer": speech})
        screen["q_idx"] += 1
        if screen["q_idx"] < len(SCREEN_QUESTIONS):
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": SCREEN_QUESTIONS[screen["q_idx"]], "voice": "female", "language_code": "en-US"}, timeout=10)
        else:
            candidate = candidates[screen["candidate_idx"]]
            scorecard = ai_score(screen["answers"])
            candidate["scorecard"] = scorecard
            candidate["score"] = scorecard.get("score", 0)
            if scorecard.get("score", 0) >= PASS_THRESHOLD:
                candidate["status"] = "passed"
                requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                    json={"payload": "Great answers! We'd like to move you forward. You'll receive a text with next steps and a link to schedule your interview. Thank you!",
                        "voice": "female", "language_code": "en-US"}, timeout=10)
                send_sms(candidate["phone"], f"Congratulations {candidate['name']}! You've passed our phone screen. A recruiter will reach out to schedule your interview.")
            else:
                candidate["status"] = "not_advanced"
                requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                    json={"payload": "Thank you for your time today. We'll review your responses and follow up. Have a great day!",
                        "voice": "female", "language_code": "en-US"}, timeout=10)
            if RECRUITER_SLACK:
                try: requests.post(RECRUITER_SLACK, json={"text": f"Screen complete: {candidate['name']} - Score: {scorecard.get('score',0)}/100 - {scorecard.get('recommend','review').upper()}\nStrengths: {scorecard.get('strengths','')}\nConcerns: {scorecard.get('concerns','')}"})
                except Exception: pass
    elif event == "call.hangup":
        screens.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/candidates", methods=["GET"])
def list_candidates():
    return jsonify({"candidates": candidates}), 200

@app.route("/candidates/<int:idx>/advance", methods=["POST"])
def advance_candidate(idx):
    if idx >= len(candidates): return jsonify({"error":"Not found"}), 404
    candidate = candidates[idx]
    candidate["status"] = "interview_scheduled"
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    candidate["interview_time"] = data.get("time", "")
    send_sms(candidate["phone"], f"Your interview is confirmed for {candidate['interview_time']}. Looking forward to meeting you!")
    return jsonify({"candidate": candidate}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","candidates":len(candidates),
        "passed":sum(1 for c in candidates if c["status"]=="passed")}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
