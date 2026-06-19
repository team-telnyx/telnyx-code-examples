#!/usr/bin/env python3
"""After-Hours Nurse Triage - AI screens symptoms using clinical decision tree, routes urgent to on-call nurse via PagerDuty, queues non-urgent for AM callback. Nurse reviews and overrides AI severity scores."""
import os, json, time, requests, telnyx
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
PAGERDUTY_KEY = os.getenv("PAGERDUTY_ROUTING_KEY", "")
NURSE_SLACK = os.getenv("NURSE_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

triage_queue = []
calls = {}

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

_start_ttl_cleanup(calls)


TRIAGE_PROMPT = """You are a medical triage nurse AI for Valley Health Clinic after-hours line.
Your job: collect symptoms, assess severity, determine routing.

SEVERITY LEVELS:
- EMERGENCY (911): chest pain, difficulty breathing, severe bleeding, stroke symptoms, allergic reaction with swelling
- URGENT (page on-call nurse): fever >103F, persistent vomiting, moderate pain, new concerning symptoms
- ROUTINE (morning callback): medication refills, mild symptoms, general questions, scheduling

ASK: symptoms, duration, severity 1-10, relevant medical history, current medications.
ALWAYS ask if they have chest pain, difficulty breathing, or feel faint.

After collecting info, state your severity assessment clearly: "Based on what you've described, I'm classifying this as [EMERGENCY/URGENT/ROUTINE]."

If EMERGENCY: tell them to hang up and call 911 immediately.
Be empathetic but thorough. Never diagnose - only triage."""

def ai_triage(conversation):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": conversation, "max_tokens": 250, "temperature": 0.2}, timeout=15)
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return "I'm having difficulty. Let me connect you with our on-call nurse directly."

def page_oncall(triage_data):
    if not PAGERDUTY_KEY:
        return
    try:
        requests.post("https://events.pagerduty.com/v2/enqueue", json={
            "routing_key": PAGERDUTY_KEY, "event_action": "trigger",
            "payload": {"summary": f"Urgent triage: {triage_data.get('symptoms', 'Unknown')} - Patient: {triage_data.get('caller', 'Unknown')}",
                "severity": "warning", "source": "telnyx-triage",
                "custom_details": triage_data}}, timeout=10)
    except Exception:
        pass

def notify_nurse(message):
    if NURSE_SLACK:
        try:
            requests.post(NURSE_SLACK, json={"text": message}, timeout=5)
        except Exception:
            pass

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers,
        json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

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
    caller = p.get("from", "")

    if event == "call.initiated" and p.get("direction") == "incoming":
        requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.answered":
        calls[ccid] = {"caller": caller, "conversation": [{"role": "system", "content": TRIAGE_PROMPT}],
            "severity": None, "symptoms": ""}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": "Thank you for calling Valley Health Clinic after-hours line. I'm here to help assess your situation. If you are experiencing a medical emergency, please hang up and call 911. Otherwise, please describe your symptoms.",
                "voice": "female", "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 3, "timeout_secs": 30,
                "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.gather.ended":
        speech = p.get("speech", {}).get("result", "")
        call = calls.get(ccid, {})
        if speech and call:
            call["symptoms"] += " " + speech
            call["conversation"].append({"role": "user", "content": speech})
            response = ai_triage(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})

            triage_entry = {"caller": call["caller"], "symptoms": call["symptoms"].strip(),
                "ai_response": response, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "status": "pending_review"}

            if "EMERGENCY" in response.upper():
                triage_entry["severity"] = "emergency"
                triage_entry["status"] = "advised_911"
            elif "URGENT" in response.upper():
                triage_entry["severity"] = "urgent"
                triage_entry["status"] = "paged_oncall"
                page_oncall(triage_entry)
                notify_nurse(f"URGENT triage page: {call['caller']} - {call['symptoms'].strip()[:200]}")
            else:
                triage_entry["severity"] = "routine"
                triage_entry["status"] = "queued_callback"
                send_sms(call["caller"], "Valley Health: Your call has been logged. A nurse will call you back during office hours (8 AM - 5 PM). If symptoms worsen, call 911.")

            triage_queue.append(triage_entry)
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": response, "voice": "female", "language_code": "en-US"}, timeout=10)
        return jsonify({"status": "ok"}), 200

    if event == "call.hangup":
        calls.pop(ccid, None)
        return jsonify({"status": "ok"}), 200

    return jsonify({"status": "ok"}), 200

@app.route("/triage/queue", methods=["GET"])
def get_queue():
    severity = request.args.get("severity")
    filtered = [t for t in triage_queue if not severity or t["severity"] == severity]
    return jsonify({"queue": filtered, "counts": {
        "emergency": sum(1 for t in triage_queue if t["severity"] == "emergency"),
        "urgent": sum(1 for t in triage_queue if t["severity"] == "urgent"),
        "routine": sum(1 for t in triage_queue if t["severity"] == "routine")}}), 200

@app.route("/triage/<int:idx>/override", methods=["POST"])
def override_severity(idx):
    if idx >= len(triage_queue):
        return jsonify({"error": "Not found"}), 404
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    entry = triage_queue[idx]
    old = entry["severity"]
    entry["severity"] = data.get("severity", entry["severity"])
    entry["override_by"] = data.get("nurse_name", "unknown")
    entry["override_note"] = data.get("note", "")
    entry["status"] = "reviewed"
    if entry["severity"] == "urgent" and old == "routine":
        page_oncall(entry)
    return jsonify({"triage": entry, "changed": old != entry["severity"]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "queue_size": len(triage_queue)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
