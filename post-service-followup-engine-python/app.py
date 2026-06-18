#!/usr/bin/env python3
"""Post-Service Follow-Up Engine - after appointment, SMS satisfaction survey. Negative responses trigger AI voice callback to understand the issue, then creates ticket in Jira and alerts manager via Slack."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
JIRA_URL = os.getenv("JIRA_URL", "")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
JIRA_TOKEN = os.getenv("JIRA_TOKEN", "")
JIRA_PROJECT = os.getenv("JIRA_PROJECT", "SUP")
MANAGER_SLACK = os.getenv("MANAGER_SLACK_WEBHOOK", "")
HUBSPOT_API_KEY = os.getenv("HUBSPOT_API_KEY", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

follow_ups = []
calls = {}

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def create_jira_ticket(summary, description):
    if not JIRA_URL: return None
    try:
        resp = requests.post(f"{JIRA_URL}/rest/api/3/issue",
            auth=(JIRA_EMAIL, JIRA_TOKEN),
            json={"fields": {"project": {"key": JIRA_PROJECT}, "summary": summary,
                "description": {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":description}]}]},
                "issuetype": {"name": "Task"}}}, timeout=15)
        return resp.json().get("key")
    except Exception:
        return None

def update_hubspot(phone, satisfaction):
    if not HUBSPOT_API_KEY: return
    try:
        requests.post("https://api.hubapi.com/crm/v3/objects/contacts/search",
            headers={"Authorization": f"Bearer {HUBSPOT_API_KEY}", "Content-Type": "application/json"},
            json={"filterGroups": [{"filters": [{"propertyName": "phone", "operator": "EQ", "value": phone}]}]}, timeout=10)
    except Exception:
        pass

@app.route("/follow-up/send", methods=["POST"])
def send_followup():
    data = request.get_json()
    customer_phone = data.get("phone")
    service_type = data.get("service", "service")
    tech_name = data.get("tech", "our technician")
    entry = {"phone": customer_phone, "service": service_type, "tech": tech_name,
        "sent_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "survey_sent", "rating": None}
    follow_ups.append(entry)
    send_sms(customer_phone, f"Hi! How was your {service_type} service with {tech_name}? Reply 1-5 (1=poor, 5=excellent)")
    return jsonify({"follow_up_id": len(follow_ups)-1, "status": "sent"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip()
    fu = next((f for f in reversed(follow_ups) if f["phone"] == sender and f["status"] == "survey_sent"), None)
    if not fu: return jsonify({"status": "ok"}), 200
    try:
        rating = int(text[0])
        if 1 <= rating <= 5:
            fu["rating"] = rating
            fu["status"] = "rated"
            if rating <= 2:
                fu["status"] = "negative_followup"
                try:
                    requests.post(f"{API}/calls", headers=headers,
                        json={"to": sender, "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                            "client_state": json.dumps({"fu_idx": follow_ups.index(fu)}).encode().hex()}, timeout=10)
                except Exception:
                    pass
                send_sms(sender, "We're sorry to hear that. A manager will call you shortly to make this right.")
                if MANAGER_SLACK:
                    try: requests.post(MANAGER_SLACK, json={"text": f"Negative review ({rating}/5) from {sender} for {fu['service']} by {fu['tech']}. AI callback initiated."}, timeout=5)
                    except Exception: pass
            elif rating >= 4:
                send_sms(sender, "Thank you for the great feedback! We appreciate your business.")
                fu["status"] = "completed"
            else:
                send_sms(sender, "Thank you for your feedback. We'll use it to improve our service.")
                fu["status"] = "completed"
            update_hubspot(sender, rating)
    except (ValueError, IndexError):
        send_sms(sender, "Please reply with a number 1-5 (1=poor, 5=excellent)")
    return jsonify({"status": "ok"}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    if event == "call.answered":
        calls[ccid] = {"conversation": [{"role": "system", "content": "You are a customer service manager following up on a negative experience. Be empathetic, listen carefully, offer concrete resolution (discount, redo, refund). Collect specifics about what went wrong."}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Hi, this is the service manager at ProFix. I saw your feedback and I want to personally make sure we get this right. Can you tell me what happened?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 3, "timeout_secs": 30, "language_code": "en-US"}, timeout=10)
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
                response = "I understand. Let me create a ticket and have our team lead follow up with you directly."
            call["conversation"].append({"role": "assistant", "content": response})
            ticket = create_jira_ticket(f"Negative customer feedback - {data.get('from','')}", speech)
            if ticket:
                call["ticket"] = ticket
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/follow-ups", methods=["GET"])
def list_followups():
    return jsonify({"follow_ups": follow_ups, "stats": {
        "total": len(follow_ups), "avg_rating": sum(f["rating"] for f in follow_ups if f["rating"]) / max(1, sum(1 for f in follow_ups if f["rating"])),
        "negative": sum(1 for f in follow_ups if f.get("rating") and f["rating"] <= 2)}}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "follow_ups": len(follow_ups)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
