#!/usr/bin/env python3
"""Hotel Guest Services Line - room service, housekeeping, concierge requests via voice or SMS. AI routes and tracks. Staff gets Slack notifications, guest gets SMS when fulfilled."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STAFF_SLACK = os.getenv("STAFF_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

rooms = {"101": {"guest": "Smith", "phone": "+15559001234"}, "205": {"guest": "Chen", "phone": "+15559005678"}}
service_requests = []
calls = {}

SYSTEM_PROMPT = """You are the AI concierge for The Grand Hotel.
Services: room service (menu items + prices), housekeeping (towels, toiletries, cleaning), concierge (restaurant reservations, transportation, tours), maintenance (broken items, AC/heat issues).
Identify the guest by room number. Be warm and professional.
For room service, confirm the order and total.
For maintenance emergencies (flooding, fire, lock issues), mark URGENT."""

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def ai_categorize(text):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": "Categorize this hotel guest request. Reply JSON: {\"department\": \"room_service|housekeeping|concierge|maintenance\", \"urgency\": \"normal|urgent\", \"summary\": \"brief\"}"},
                {"role": "user", "content": text}], "max_tokens": 80, "temperature": 0.1}, timeout=15)
        return json.loads(resp.json()["choices"][0]["message"]["content"].strip().strip("`").replace("json\n",""))
    except Exception:
        return {"department": "concierge", "urgency": "normal", "summary": text[:80]}

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "")
    room = next((r for r, info in rooms.items() if info["phone"] == sender), "unknown")
    guest = rooms.get(room, {}).get("guest", "Guest")
    result = ai_categorize(text)
    req = {"id": len(service_requests), "room": room, "guest": guest, "phone": sender,
        "department": result["department"], "urgency": result["urgency"],
        "summary": result["summary"], "original": text,
        "status": "open", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    service_requests.append(req)
    send_sms(sender, f"Thank you, {guest}. Your {result['department'].replace('_',' ')} request has been received (#{req['id']}). {'URGENT - staff dispatched immediately.' if result['urgency']=='urgent' else 'We will update you shortly.'}")
    if STAFF_SLACK:
        emoji = "🔴" if result["urgency"] == "urgent" else "🔵"
        try: requests.post(STAFF_SLACK, json={"text": f"{emoji} Room {room} ({guest}): {result['department']} - {result['summary']}"}, timeout=5)
        except Exception: pass
    return jsonify({"status": "ok"}), 200

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
        room = next((r for r, info in rooms.items() if info["phone"] == caller), None)
        greeting = f"Good evening, {rooms[room]['guest']}! " if room else "Welcome to The Grand Hotel! May I have your room number? "
        calls[ccid] = {"caller": caller, "room": room, "conversation": [{"role":"system","content":SYSTEM_PROMPT}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": greeting + "How may I assist you?", "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type":"speech","end_silence_timeout_secs":2,"timeout_secs":20,"language_code":"en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech",{}).get("result","")
        call = calls.get(ccid,{})
        if speech and call:
            call["conversation"].append({"role":"user","content":speech})
            try:
                resp = requests.post(INFERENCE_URL, headers=headers,
                    json={"model":AI_MODEL,"messages":call["conversation"],"max_tokens":200,"temperature":0.3}, timeout=15)
                response = resp.json()["choices"][0]["message"]["content"]
            except Exception:
                response = "I'll connect you with the front desk right away."
            call["conversation"].append({"role":"assistant","content":response})
            result = ai_categorize(speech)
            req = {"id":len(service_requests),"room":call.get("room","?"),"phone":call["caller"],
                "department":result["department"],"summary":result["summary"],"status":"open",
                "urgency":result["urgency"],"created_at":time.strftime("%Y-%m-%dT%H:%M:%SZ")}
            service_requests.append(req)
            if STAFF_SLACK:
                try: requests.post(STAFF_SLACK, json={"text":f"Room {req['room']}: {req['department']} - {req['summary']}"}, timeout=5)
                except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":response,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status":"ok"}), 200

@app.route("/requests", methods=["GET"])
def list_requests():
    dept = request.args.get("department")
    filtered = [r for r in service_requests if not dept or r["department"]==dept]
    return jsonify({"requests": filtered}), 200

@app.route("/requests/<int:idx>/complete", methods=["POST"])
def complete_request(idx):
    if idx >= len(service_requests): return jsonify({"error":"Not found"}), 404
    req = service_requests[idx]
    req["status"] = "completed"
    req["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    send_sms(req["phone"], f"The Grand Hotel: Your {req['department'].replace('_',' ')} request has been fulfilled. Need anything else? Just text this number.")
    return jsonify({"request": req}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","open":sum(1 for r in service_requests if r["status"]=="open")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
