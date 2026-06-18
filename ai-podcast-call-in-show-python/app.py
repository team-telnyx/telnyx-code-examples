#!/usr/bin/env python3
"""AI Podcast Call-In Show — callers dial in, AI screens and queues them, host manages live."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
SHOW_NUMBER = os.getenv("SHOW_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

caller_queue = []
active_calls = {}
show_log = []

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def screen_caller(topic, name):
    messages = [{"role": "system", "content": "You screen callers for a podcast. Return JSON: approved (boolean), topic_quality (1-5), suggested_intro (string for host). Approve if topic is interesting and relevant."},
        {"role": "user", "content": f"Caller: {name}, Topic: {topic}"}]
    return call_inference(messages)

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    call = active_calls.get(ccid)
    if event_type == "call.initiated" and data.get("direction") == "incoming":
        active_calls[ccid] = {"caller": data.get("from", "unknown"), "state": "greeting", "name": "", "topic": ""}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Welcome to the show! What's your first name?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if call["state"] == "greeting":
            call["name"] = speech or "Anonymous"
            call["state"] = "topic"
            client.calls.actions.speak(ccid, payload=f"Great, {call['name']}! What topic would you like to discuss on air?", voice="female", language_code="en-US")
        elif call["state"] == "topic":
            call["topic"] = speech or "general"
            try:
                screening = json.loads(screen_caller(call["topic"], call["name"]))
                if screening.get("approved", True):
                    caller_queue.append({"ccid": ccid, "name": call["name"], "topic": call["topic"], "screening": screening})
                    position = len(caller_queue)
                    client.calls.actions.speak(ccid, payload=f"You're approved! You're number {position} in the queue. Please hold.", voice="female", language_code="en-US")
                    call["state"] = "holding"
                else:
                    client.calls.actions.speak(ccid, payload="Thanks for calling! Unfortunately we can't fit that topic today. Try calling next week!", voice="female", language_code="en-US")
                    call["state"] = "rejected"
            except Exception:
                caller_queue.append({"ccid": ccid, "name": call["name"], "topic": call["topic"]})
                client.calls.actions.speak(ccid, payload="You're in the queue. Please hold!", voice="female", language_code="en-US")
                call["state"] = "holding"
        return jsonify({"status": "processing"}), 200
    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        caller_queue[:] = [c for c in caller_queue if c.get("ccid") != ccid]
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/queue", methods=["GET"])
def get_queue():
    return jsonify({"queue": [{"name": c["name"], "topic": c["topic"], "position": i+1} for i, c in enumerate(caller_queue)]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "queue": len(caller_queue), "active": len(active_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
