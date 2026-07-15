#!/usr/bin/env python3
"""AI Negotiation Practice Phone — practice salary negotiations, sales deals, or vendor contracts with an AI that plays the opposing side and scores your technique."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
PRACTICE_NUMBER = os.getenv("PRACTICE_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}

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

_start_ttl_cleanup(active_calls)

sessions = []

SCENARIOS = {"1": {"role": "hiring manager", "context": "The candidate wants $180K. Your budget is $155K with flexibility to $165K. Push back on experience level. You can offer equity or signing bonus as alternatives."},
    "2": {"role": "enterprise buyer", "context": "You're evaluating their SaaS product at $50K/year. You have a competing offer at $35K. Your budget is $45K. Ask for volume discounts and longer payment terms."},
    "3": {"role": "vendor account manager", "context": "The client wants to reduce their contract by 40%. They're a top-10 account. You can offer 15% discount max, or restructure the deal with different terms."}}

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

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
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    call = active_calls.get(ccid)
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[ccid] = {"state": "select", "conversation": [], "start": time.time()}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Negotiation Practice! Press 1 for salary negotiation, 2 for sales deal, 3 for vendor contract.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        if call["state"] == "select":
            client.calls.actions.gather(ccid, input_type="dtmf", timeout_secs=10, min_digits=1, max_digits=1)
        else:
            client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        digits = p.get("digits", "")
        speech = p.get("speech", {}).get("result", "")
        if call["state"] == "select":
            scenario = SCENARIOS.get(digits, SCENARIOS["1"])
            call["state"] = "negotiating"
            call["scenario"] = scenario
            call["conversation"] = [{"role": "system", "content": f"You are a {scenario['role']} in a negotiation. {scenario['context']} Stay in character. Be firm but fair. Push back on their first offer. Keep responses under 2 sentences. After 6 exchanges, start wrapping up."}]
            opening = call_inference(call["conversation"] + [{"role": "user", "content": "The negotiation begins. Make your opening position."}])
            call["conversation"].append({"role": "assistant", "content": opening})
            client.calls.actions.speak(ccid, payload=opening, voice="female", language_code="en-US")
        elif call["state"] == "negotiating" and speech:
            call["conversation"].append({"role": "user", "content": speech})
            response = call_inference(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        return jsonify({"status": "negotiating"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and len(call.get("conversation", [])) > 3:
            score_prompt = [{"role": "system", "content": "Score this negotiation practice. Return JSON: anchoring (1-10), concession_strategy (1-10), active_listening (1-10), creativity (1-10), confidence (1-10), overall (1-10), strengths (list), improvements (list), deal_outcome (string)."},
                {"role": "user", "content": chr(10).join(f"{m['role']}: {m['content']}" for m in call["conversation"] if m["role"] != "system")}]
            try:
                score = json.loads(call_inference(score_prompt, max_tokens=400))
                sessions.append({"scenario": call.get("scenario", {}).get("role"), "score": score, "duration": int(time.time() - call["start"])})
            except Exception:
                pass
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/sessions", methods=["GET"])
def list_sessions():
    return jsonify({"sessions": sessions[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "sessions": len(sessions)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
