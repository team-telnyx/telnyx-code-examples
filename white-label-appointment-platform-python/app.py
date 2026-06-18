#!/usr/bin/env python3
"""White-Label Appointment Platform - multi-tenant SaaS that gives any service business their own AI phone line with booking, reminders, and calendar sync. Each tenant has own number, greeting, and config."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

tenants = {}
appointments = {}
calls = {}

@app.route("/tenants", methods=["POST"])
def create_tenant():
    data = request.get_json()
    tid = data.get("id", f"t-{int(time.time())}")
    tenant = {"id": tid, "business_name": data.get("business_name"),
        "phone_number": data.get("phone_number"), "greeting": data.get("greeting", f"Thank you for calling {data.get('business_name')}"),
        "services": data.get("services", []),
        "hours": data.get("hours", "Monday-Friday 9AM-5PM"),
        "calendar_webhook": data.get("calendar_webhook", ""),
        "notification_phone": data.get("notification_phone", ""),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    tenants[tid] = tenant
    appointments[tid] = []
    return jsonify({"tenant": tenant}), 200

def get_tenant_by_number(phone):
    return next((t for t in tenants.values() if t["phone_number"] == phone), None)

def send_sms(to, from_num, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": from_num, "to": to, "text": text}, timeout=10)

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    caller = data.get("from", "")
    called = data.get("to", "")
    if event == "call.initiated" and data.get("direction") == "incoming":
        requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
    elif event == "call.answered":
        tenant = get_tenant_by_number(called)
        if not tenant:
            requests.post(f"{API}/calls/{ccid}/actions/hangup", headers=headers, json={}, timeout=10)
            return jsonify({"status":"no_tenant"}), 200
        prompt = f"You are the receptionist for {tenant['business_name']}. Hours: {tenant['hours']}. Services: {', '.join(tenant['services'])}. Book appointments, answer questions about services."
        calls[ccid] = {"caller": caller, "tenant_id": tenant["id"],
            "conversation": [{"role":"system","content":prompt}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": tenant["greeting"] + ". How can I help you today?",
                "voice":"female","language_code":"en-US"}, timeout=10)
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
                response = "Let me check on that for you."
            call["conversation"].append({"role":"assistant","content":response})
            if any(w in response.lower() for w in ["booked","confirmed","scheduled"]):
                tid = call["tenant_id"]
                tenant = tenants[tid]
                appt = {"caller":caller,"notes":speech,"status":"confirmed","booked_at":time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                appointments[tid].append(appt)
                send_sms(caller, tenant["phone_number"], f"{tenant['business_name']}: Appointment confirmed! Reply CANCEL to cancel.")
                if tenant.get("notification_phone"):
                    send_sms(tenant["notification_phone"], tenant["phone_number"], f"New booking from {caller}: {speech}")
                if tenant.get("calendar_webhook"):
                    try: requests.post(tenant["calendar_webhook"], json=appt, timeout=5)
                    except Exception: pass
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":response,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status":"ok"}), 200

@app.route("/tenants", methods=["GET"])
def list_tenants():
    return jsonify({"tenants": list(tenants.values())}), 200

@app.route("/tenants/<tid>/appointments", methods=["GET"])
def tenant_appointments(tid):
    return jsonify({"appointments": appointments.get(tid, [])}), 200

@app.route("/tenants/<tid>/stats", methods=["GET"])
def tenant_stats(tid):
    appts = appointments.get(tid, [])
    return jsonify({"total":len(appts),"confirmed":sum(1 for a in appts if a["status"]=="confirmed")}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","tenants":len(tenants),"total_appointments":sum(len(a) for a in appointments.values())}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
