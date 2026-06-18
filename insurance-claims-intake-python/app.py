#!/usr/bin/env python3
"""Insurance Claims Intake - policyholder calls, AI collects incident details, accepts photos via MMS, creates claim, assigns adjuster, texts status updates. Adjuster reviews AI-prepared claim."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
ADJUSTER_SLACK = os.getenv("ADJUSTER_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

policies = {"POL-1001": {"name": "John Smith", "phone": "+15559004001", "type": "auto", "deductible": 500},
    "POL-1002": {"name": "Sarah Lee", "phone": "+15559004002", "type": "home", "deductible": 1000}}
claims = []
calls = {}

SYSTEM_PROMPT = """You are a claims intake specialist for SecureShield Insurance.
Collect: policy number, type of incident, date/time of incident, location, description of damage, other parties involved, police report number (if applicable), injuries.
Verify policyholder identity by name and policy number.
Be empathetic - they've just experienced a loss.
After collecting all info, confirm the claim will be submitted for adjuster review."""

def ai_respond(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 200, "temperature": 0.3}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "Let me connect you with an agent directly."

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    caller = data.get("from", "")
    if event == "call.initiated" and data.get("direction") == "incoming":
        requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
    elif event == "call.answered":
        calls[ccid] = {"caller": caller, "conversation": [{"role":"system","content":SYSTEM_PROMPT}], "details": ""}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling SecureShield Insurance claims department. I'm here to help you file a claim. Can I start with your policy number?",
                "voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type":"speech","end_silence_timeout_secs":3,"timeout_secs":30,"language_code":"en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech",{}).get("result","")
        call = calls.get(ccid,{})
        if speech and call:
            call["details"] += " " + speech
            call["conversation"].append({"role":"user","content":speech})
            response = ai_respond(call["conversation"])
            call["conversation"].append({"role":"assistant","content":response})
            if any(w in response.lower() for w in ["submitted","filed","created","claim number"]):
                claim = {"id": f"CLM-{len(claims)+1001}", "caller": caller,
                    "details": call["details"].strip(), "status": "pending_review",
                    "photos": [], "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                claims.append(claim)
                send_sms(caller, f"SecureShield: Claim {claim['id']} filed. Text photos of damage to this number. An adjuster will review within 24 hours.")
                if ADJUSTER_SLACK:
                    try: requests.post(ADJUSTER_SLACK, json={"text": f"New claim {claim['id']}: {caller}\n{call['details'][:300]}"}, timeout=5)
                    except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":response,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status":"ok"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    media = data.get("media", [])
    if media:
        claim = next((c for c in reversed(claims) if c["caller"] == sender), None)
        if claim:
            claim["photos"].extend([m.get("url","") for m in media])
            send_sms(sender, f"Photo received for claim {claim['id']}. {len(claim['photos'])} photo(s) on file.")
    return jsonify({"status":"ok"}), 200

@app.route("/claims", methods=["GET"])
def list_claims():
    return jsonify({"claims": claims}), 200

@app.route("/claims/<claim_id>/assign", methods=["POST"])
def assign_adjuster(claim_id):
    claim = next((c for c in claims if c["id"]==claim_id), None)
    if not claim: return jsonify({"error":"Not found"}), 404
    data = request.get_json() or {}
    claim["adjuster"] = data.get("adjuster","")
    claim["status"] = "assigned"
    send_sms(claim["caller"], f"SecureShield: Adjuster {claim['adjuster']} has been assigned to your claim {claim_id}. They will contact you within 48 hours.")
    return jsonify({"claim": claim}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","claims":len(claims),"pending":sum(1 for c in claims if c["status"]=="pending_review")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
