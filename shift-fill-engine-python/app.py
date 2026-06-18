#!/usr/bin/env python3
"""Shift Fill Engine - open shift triggers calls down the availability list. First to confirm gets it, rest are cancelled. Texts confirmation + notifies manager via Slack."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
MANAGER_SLACK = os.getenv("MANAGER_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

employees = [
    {"name": "Alex Rivera", "phone": "+15559001001", "role": "nurse", "priority": 1},
    {"name": "Jordan Lee", "phone": "+15559001002", "role": "nurse", "priority": 2},
    {"name": "Casey Kim", "phone": "+15559001003", "role": "nurse", "priority": 3},
    {"name": "Sam Patel", "phone": "+15559001004", "role": "nurse", "priority": 4},
]
open_shifts = []
active_fills = {}

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def call_next(shift_id):
    shift = next((s for s in open_shifts if s["id"] == shift_id), None)
    if not shift or shift["status"] == "filled": return
    candidates = [e for e in employees if e["role"] == shift["role"] and e["phone"] not in shift.get("declined", [])]
    candidates.sort(key=lambda x: x["priority"])
    called = shift.get("called", [])
    remaining = [c for c in candidates if c["phone"] not in called]
    if not remaining:
        shift["status"] = "unfilled"
        if MANAGER_SLACK:
            try: requests.post(MANAGER_SLACK, json={"text": f"UNFILLED: {shift['role']} shift {shift['date']} {shift['time']} - all candidates exhausted"}, timeout=5)
            except Exception: pass
        return
    emp = remaining[0]
    shift.setdefault("called", []).append(emp["phone"])
    try:
        resp = requests.post(f"{API}/calls", headers=headers,
            json={"to": emp["phone"], "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps({"shift_id": shift_id, "emp": emp["name"]}).encode().hex()}, timeout=10)
        active_fills[resp.json().get("data",{}).get("call_control_id","")] = {"shift_id": shift_id, "emp": emp}
    except Exception:
        call_next(shift_id)

@app.route("/shifts/open", methods=["POST"])
def open_shift():
    data = request.get_json()
    shift = {"id": len(open_shifts), "role": data.get("role", "nurse"),
        "date": data.get("date"), "time": data.get("time"),
        "department": data.get("department", ""),
        "status": "calling", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "called": [], "declined": []}
    open_shifts.append(shift)
    call_next(shift["id"])
    return jsonify({"shift": shift}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    fill = active_fills.get(ccid, {})
    shift_id = fill.get("shift_id")
    emp = fill.get("emp", {})

    if event == "call.answered" and shift_id is not None:
        shift = open_shifts[shift_id]
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": f"Hi {emp.get('name','')}, we have an open {shift['role']} shift on {shift['date']} at {shift['time']}. Press 1 to accept or 2 to decline.",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended" and shift_id is not None:
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "dtmf", "timeout_secs": 15, "valid_digits": "12", "max_digits": 1}, timeout=10)
    elif event == "call.gather.ended" and shift_id is not None:
        digits = data.get("dtmf", {}).get("digits", "")
        shift = open_shifts[shift_id]
        if digits == "1" and shift["status"] != "filled":
            shift["status"] = "filled"
            shift["filled_by"] = emp.get("name")
            shift["filled_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": f"You're confirmed for {shift['date']} at {shift['time']}. You'll get a text with details. Thank you!",
                    "voice": "female", "language_code": "en-US"}, timeout=10)
            send_sms(emp["phone"], f"CONFIRMED: {shift['role']} shift {shift['date']} {shift['time']}. Department: {shift.get('department','')}.")
            if MANAGER_SLACK:
                try: requests.post(MANAGER_SLACK, json={"text": f"Shift filled: {shift['date']} {shift['time']} by {emp['name']}"}, timeout=5)
                except Exception: pass
        elif digits == "2":
            shift.setdefault("declined", []).append(emp.get("phone",""))
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "No problem. Thanks for letting us know.", "voice": "female", "language_code": "en-US"}, timeout=10)
            call_next(shift_id)
        else:
            call_next(shift_id)
    elif event == "call.hangup":
        if shift_id is not None:
            shift = open_shifts[shift_id]
            if shift["status"] != "filled":
                shift.setdefault("declined", []).append(emp.get("phone",""))
                call_next(shift_id)
        active_fills.pop(ccid, None)
    return jsonify({"status": "ok"}), 200

@app.route("/shifts", methods=["GET"])
def list_shifts():
    return jsonify({"shifts": open_shifts}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","open":sum(1 for s in open_shifts if s["status"]=="calling"),
        "filled":sum(1 for s in open_shifts if s["status"]=="filled")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
