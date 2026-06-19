#!/usr/bin/env python3
"""AI Insurance Claims Intake — voice agent collects claim details, classifies, routes to adjuster."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CLAIMS_NUMBER = os.getenv("CLAIMS_NUMBER")
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

claims = []

SYSTEM_PROMPT = """You are an insurance claims intake specialist. Collect the following from the caller:
1. Policy number or name on policy
2. Type of claim (auto, home, health, life)
3. Date of incident
4. Brief description of what happened
5. Any injuries or urgent needs
Be empathetic and professional. If they mention injuries, express concern and ask if they need emergency services.
Keep responses under 2 sentences."""

def call_inference(messages, max_tokens=150):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def extract_claim(conversation):
    msgs = [{"role": "system", "content": "Extract claim data from this conversation. Return JSON: policy_number (string or null), claim_type (auto/home/health/life/other), incident_date (string or null), description (string), injuries (boolean), urgency (low/medium/high), complete (boolean - true if all required info collected)."},
        {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in conversation if m['role'] != 'system')}]
    return call_inference(msgs, max_tokens=300)

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
        active_calls[ccid] = {"caller": p.get("from"), "conversation": [{"role": "system", "content": SYSTEM_PROMPT}]}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Thank you for calling claims. I'm here to help you file a claim. Can I start with your policy number or the name on your policy?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = p.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="I'm sorry, I didn't catch that. Could you repeat?", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and len(call["conversation"]) > 3:
            try:
                claim_data = json.loads(extract_claim(call["conversation"]))
                claim_data["caller"] = call["caller"]
                claim_data["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                claims.append(claim_data)
                if claim_data.get("injuries") or claim_data.get("urgency") == "high":
                    try:
                        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                            json={"from": CLAIMS_NUMBER, "to": CLAIMS_NUMBER, "text": f"URGENT CLAIM: {claim_data.get('claim_type', 'unknown')} - injuries reported. Caller: {call['caller']}"}, timeout=10)
                    except Exception:
                        pass
            except Exception as e:
                app.logger.error("Claim extraction failed: %s", e)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/claims", methods=["GET"])
def list_claims():
    return jsonify({"claims": claims[-50:], "total": len(claims)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "claims": len(claims), "active": len(active_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
