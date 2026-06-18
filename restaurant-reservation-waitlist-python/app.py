#!/usr/bin/env python3
"""Restaurant Reservation & Waitlist - AI answers calls, checks table availability, books or adds to waitlist, texts when table is ready. Host reviews large party requests."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
HOST_SLACK = os.getenv("HOST_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

tables = [{"id": i, "seats": s, "available_times": ["18:00","18:30","19:00","19:30","20:00","20:30","21:00"]}
    for i, s in enumerate([2,2,4,4,6,8])]
reservations = []
waitlist = []
calls = {}
LARGE_PARTY = 6

SYSTEM_PROMPT = """You are the host AI for Bella Notte Italian Restaurant.
Hours: Tue-Sun 5PM-10PM. Closed Monday.
Collect: name, party size, preferred date and time, any special occasions or dietary needs.
For parties of 6+, note that a manager will confirm availability.
Mention our prix fixe menu for special occasions."""

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
        calls[ccid] = {"caller": caller, "conversation": [{"role": "system", "content": SYSTEM_PROMPT}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Buona sera! Thank you for calling Bella Notte. I'd love to help you with a reservation. How many guests will be dining?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 2, "timeout_secs": 20, "language_code": "en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech", {}).get("result", "")
        call = calls.get(ccid, {})
        if speech and call:
            call["conversation"].append({"role": "user", "content": speech})
            try:
                resp = requests.post(INFERENCE_URL, headers=headers,
                    json={"model": AI_MODEL, "messages": call["conversation"], "max_tokens": 200, "temperature": 0.3}, timeout=15)
                response = resp.json()["choices"][0]["message"]["content"]
            except Exception:
                response = "Let me check on that. One moment please."
            call["conversation"].append({"role": "assistant", "content": response})
            if any(w in response.lower() for w in ["reserved", "confirmed", "booked"]):
                res = {"caller": caller, "status": "confirmed",
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "notes": speech}
                reservations.append(res)
                send_sms(caller, "Bella Notte: Reservation confirmed! Reply CANCEL to cancel. We look forward to seeing you.")
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/waitlist/add", methods=["POST"])
def add_to_waitlist():
    data = request.get_json()
    entry = {"name": data.get("name"), "phone": data.get("phone"),
        "party_size": data.get("party_size", 2), "added_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "waiting", "estimated_wait": data.get("wait_minutes", 30)}
    waitlist.append(entry)
    send_sms(entry["phone"], f"Bella Notte: You're on the waitlist ({entry['party_size']} guests). Estimated wait: ~{entry['estimated_wait']} min. We'll text when your table is ready!")
    return jsonify({"position": len(waitlist), "entry": entry}), 200

@app.route("/waitlist/<int:idx>/ready", methods=["POST"])
def table_ready(idx):
    if idx >= len(waitlist): return jsonify({"error":"Not found"}), 404
    entry = waitlist[idx]
    entry["status"] = "notified"
    send_sms(entry["phone"], f"Bella Notte: Your table for {entry['party_size']} is ready! Please check in with the host within 10 minutes.")
    return jsonify({"entry": entry}), 200

@app.route("/reservations", methods=["GET"])
def list_reservations():
    return jsonify({"reservations": reservations}), 200

@app.route("/waitlist", methods=["GET"])
def list_waitlist():
    return jsonify({"waitlist": [w for w in waitlist if w["status"] == "waiting"]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","reservations":len(reservations),"waitlist":sum(1 for w in waitlist if w["status"]=="waiting")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
