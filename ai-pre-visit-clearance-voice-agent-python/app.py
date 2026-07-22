#!/usr/bin/env python3
"""AI Pre-Visit Clearance Voice Agent."""
from __future__ import annotations
import json, os, re, threading, time, uuid
from datetime import datetime, timezone
from typing import Any
import requests, telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER", "")
AI_MODEL = os.getenv("AI_MODEL", "openai/gpt-4o")
TTS_VOICE = os.getenv("TTS_VOICE", "Telnyx.NaturalHD.astra")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "en-US")
STAFF_SLACK_WEBHOOK = os.getenv("STAFF_SLACK_WEBHOOK", "")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

PATIENTS = {"P001":{"name":"Jordan Lee","dob":"03/15/1990","phone":"+15559001234","insurance":"Blue Cross Blue Shield","insurance_id":"BCB123456789","provider":"Dr. Smith, Northside Clinic"}}
URGENT_KW = ("urgent","emergency","asap","right away","can't wait","severe pain","immediately")
tickets = []
calls = {}
processed_events = {}

def _already_processed(eid):
    if not eid: return False
    if eid in processed_events: return True
    processed_events[eid] = time.time(); return False

def _verify():
    if not TELNYX_PUBLIC_KEY: return True
    try: telnyx_client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers)); return True
    except: return False

def _post(url, body, timeout=10):
    try:
        r = requests.post(url, headers=HEADERS, json=body, timeout=timeout)
        app.logger.info("POST %s -> %d", url, r.status_code)
        if r.status_code >= 400:
            app.logger.error("POST %s -> %d: %s", url, r.status_code, r.text[:500])
        r.raise_for_status(); return r.json()
    except Exception as e:
        app.logger.error("POST %s failed: %s", url, e)
        return None

def send_sms(to, text):
    if not to: return False
    return _post(f"{API}/messages", {"from": MAIN_NUMBER, "to": to, "text": text}) is not None

def slack_alert(text):
    if not STAFF_SLACK_WEBHOOK: return
    try: requests.post(STAFF_SLACK_WEBHOOK, json={"text": text}, timeout=5)
    except: pass

def _now(): return datetime.now(timezone.utc).isoformat()

def lookup_patient(phone):
    for p in PATIENTS.values():
        if p.get("phone") == phone: return p
    return None

def classify(text):
    fb = {"procedure":"unknown","urgency":"routine","is_medication":False,"is_imaging":False,"is_surgery":False,"summary":text[:120]}
    try:
        r = requests.post(INFERENCE_URL, headers=HEADERS, json={"model":AI_MODEL,"messages":[{"role":"system","content":"Classify this healthcare clearance request. Return ONLY JSON: procedure, urgency (urgent|routine), is_medication (bool), is_imaging (bool), is_surgery (bool), summary (<=100 chars). No medical advice."},{"role":"user","content":text}],"max_tokens":300,"temperature":0.1}, timeout=15)
        r.raise_for_status()
        c = r.json()["choices"][0]["message"]["content"].strip()
        c = re.sub(r"^```(?:json)?\s*","",c).strip("`").strip()
        p = json.loads(c)
        return {"procedure":p.get("procedure",fb["procedure"]),"urgency":p.get("urgency",fb["urgency"]),"is_medication":bool(p.get("is_medication",False)),"is_imaging":bool(p.get("is_imaging",False)),"is_surgery":bool(p.get("is_surgery",False)),"summary":(p.get("summary") or fb["summary"])[:120]}
    except:
        if any(k in text.lower() for k in URGENT_KW): fb["urgency"] = "urgent"
        return fb

def create_ticket(patient, cls, caller, transcript):
    t = {"ticket_id":f"CLR-{uuid.uuid4().hex[:8]}","patient_name":patient.get("name","Unknown"),"dob":patient.get("dob",""),"phone":patient.get("phone",caller),"insurance":patient.get("insurance",""),"insurance_id":patient.get("insurance_id",""),"provider":patient.get("provider",""),"procedure":cls["procedure"],"urgency":cls["urgency"],"is_medication":cls["is_medication"],"is_imaging":cls["is_imaging"],"is_surgery":cls["is_surgery"],"summary":cls["summary"],"status":"open","created_at":_now(),"transcript":transcript}
    tickets.append(t)
    if t["phone"]:
        msg = "URGENT — flagged for immediate review." if t["urgency"]=="urgent" else "We'll process this within 2 business days."
        send_sms(t["phone"], f"Hi {t['patient_name']}, your pre-visit clearance request for {t['procedure']} has been submitted (ticket {t['ticket_id']}). {msg}")
    emoji = ":rotating_light:" if t["urgency"]=="urgent" else ":clipboard:"
    slack_alert(f"{emoji} Pre-Visit Clearance {t['ticket_id']}: {t['patient_name']} — {t['procedure']} — {t['insurance']} — {t['urgency']}")
    return t

def _command_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex}"

def answer_call(ccid):
    _post(f"{API}/calls/{ccid}/actions/answer", {
        "send_silence_when_idle": True,
        "command_id": _command_id("answer"),
    })

def prompt_and_collect(ccid, text):
    """Play a prompt and collect one spoken caller response."""
    _post(f"{API}/calls/{ccid}/actions/gather_using_ai", {
        "greeting": text,
        "voice": TTS_VOICE,
        "parameters": {
            "type": "object",
            "properties": {
                "utterance": {
                    "type": "string",
                    "description": "The caller's spoken answer, transcribed verbatim.",
                }
            },
            "required": ["utterance"],
        },
        "assistant": {
            "model": AI_MODEL,
            "instructions": (
                "You are a one-turn speech capture component. Ask no follow-up "
                "questions unless the caller is silent. Do not make decisions, "
                "give advice, or continue the conversation. Capture exactly what "
                "the caller says in the utterance field."
            ),
        },
        "transcription": {"language": "en"},
        "user_response_timeout_ms": 15000,
        "command_id": _command_id("ai-gather"),
    })

def speak_only(ccid, text):
    """Speak without collecting another caller response."""
    _post(f"{API}/calls/{ccid}/actions/speak", {
        "payload": text,
        "voice": TTS_VOICE,
        "language_code": TTS_LANGUAGE,
        "command_id": _command_id("speak"),
    })

def _ai_gather_speech(p):
    result = p.get("result") or {}
    if isinstance(result, dict) and result.get("utterance"):
        return str(result["utterance"]).strip()
    for msg in reversed(p.get("message_history") or []):
        if msg.get("role") == "user" and msg.get("content"):
            return str(msg["content"]).strip()
    return ""

def handle_speech(ccid, caller, call, speech):
    app.logger.info("Gathered: %r (step=%s)", speech, call["step"])

    if not speech:
        if call["step"] == "awaiting_dob":
            prompt_and_collect(ccid, "Sorry, I didn't catch that. Could you tell me your date of birth?")
        else:
            prompt_and_collect(ccid, "Sorry, I didn't catch that. Could you say that again?")
        return "reprompt"

    call["transcript"].append({"role":"user","content":speech})

    if call["step"] == "awaiting_dob":
        dob = speech.strip().replace(" ","")
        matched = None
        for pd in PATIENTS.values():
            if pd.get("dob","").replace("/","") == dob.replace("/",""): matched = pd; break
        if matched:
            call["patient"] = matched; call["step"] = "awaiting_request"
            prompt_and_collect(ccid, f"Thank you, {matched['name']}. I see you're with {matched['insurance']}. What procedure, test, or medication would you like clearance for?")
        else:
            prompt_and_collect(ccid, "I couldn't find a patient with that date of birth. Could you repeat it?")

    elif call["step"] == "awaiting_request":
        cls = classify(speech)
        if any(k in speech.lower() for k in URGENT_KW) and cls["urgency"]!="urgent": cls["urgency"]="urgent"
        call["classification"] = cls; call["step"] = "confirming"
        prompt_and_collect(ccid, f"I've got that as: {cls['procedure']}. Your provider is {call['patient'].get('provider','on file')}, insurance is {call['patient'].get('insurance','on file')}. Is that correct? Please say yes or no.")

    elif call["step"] == "confirming":
        low = speech.lower()
        if any(w in low for w in ("yes","yeah","correct","right","yep","sure")):
            t = create_ticket(call["patient"], call["classification"], caller, call["transcript"])
            call["step"] = "done"
            msg = "Your request has been flagged as urgent and will be reviewed immediately." if t["urgency"]=="urgent" else "Your request will be reviewed within 2 business days."
            speak_only(ccid, f"Perfect. Your clearance request has been submitted. Ticket number {t['ticket_id']}. {msg} You'll receive a text confirmation shortly.")
        elif any(w in low for w in ("no","wrong","incorrect","not right")):
            call["step"] = "awaiting_request"; call["classification"] = None
            prompt_and_collect(ccid, "Let's try again. What would you like to get clearance for?")
        else:
            prompt_and_collect(ccid, "Could you say yes if that's correct, or no if something needs to be changed?")

    return "ok"

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    if not _verify(): return jsonify({"error":"invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload: return jsonify({"error":"invalid request body"}), 400
    eid = payload.get("data",{}).get("id")
    if _already_processed(eid): return jsonify({"status":"duplicate"}), 200
    data = payload.get("data",{}); p = data.get("payload",{}); event = data.get("event_type")
    ccid = p.get("call_control_id",""); caller = p.get("from","")

    app.logger.info("EVENT: %s | ccid=%s | from=%s", event, ccid[:20] if ccid else "?", caller)

    calls.setdefault(ccid, {"caller":caller,"patient":None,"step":"greeting","transcript":[],"classification":None,"last_seen":time.time()})
    calls[ccid]["last_seen"] = time.time()
    call = calls[ccid]

    if event == "call.initiated" and p.get("direction")=="incoming":
        answer_call(ccid)

    elif event == "call.answered":
        patient = lookup_patient(caller)
        if patient:
            call["patient"] = patient; call["step"] = "awaiting_request"
            greeting = f"Hello {patient['name']}, this is the pre-visit clearance line. What would you like to get clearance for?"
        else:
            call["step"] = "awaiting_dob"
            greeting = "Hello, this is the pre-visit clearance line. Could you please tell me your date of birth?"
        prompt_and_collect(ccid, greeting)

    elif event == "call.speak.ended":
        app.logger.info("Speak ended. status=%s step=%s", p.get("status"), call["step"])

    elif event == "call.gather.ended":
        speech = (p.get("speech") or {}).get("result","").strip()
        return jsonify({"status":handle_speech(ccid, caller, call, speech)}), 200

    elif event == "call.ai_gather.ended":
        speech = _ai_gather_speech(p)
        return jsonify({"status":handle_speech(ccid, caller, call, speech)}), 200

    elif event == "call.hangup":
        if call["step"] not in ("done","greeting") and call.get("classification"):
            create_ticket(call["patient"] or {"name":"Unknown","phone":caller}, call["classification"], caller, call["transcript"])
        calls.pop(ccid, None)

    return jsonify({"status":"ok"}), 200

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    if not _verify(): return jsonify({"error":"invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload: return jsonify({"error":"invalid request body"}), 400
    eid = payload.get("data",{}).get("id")
    if _already_processed(eid): return jsonify({"status":"duplicate"}), 200
    data = payload.get("data",{}).get("payload",{})
    sender = data.get("from",{}).get("phone_number",""); text = data.get("text","")
    patient = lookup_patient(sender)
    if not patient:
        send_sms(sender, "We couldn't find a patient record for this number. Please call the pre-visit clearance line.")
        return jsonify({"status":"no_patient"}), 200
    cls = classify(text)
    t = create_ticket(patient, cls, sender, [{"role":"user","content":text}])
    return jsonify({"status":"ok","ticket_id":t["ticket_id"]}), 200

@app.route("/patients", methods=["POST"])
def create_patient():
    body = request.get_json(silent=True) or {}
    pid = body.get("patient_id") or f"P{uuid.uuid4().hex[:6]}"
    if pid in PATIENTS: return jsonify({"error":"patient exists"}), 409
    if not body.get("phone"): return jsonify({"error":"phone is required"}), 400
    p = {"patient_id":pid,"name":body.get("name","Patient"),"dob":body.get("dob",""),"phone":body["phone"],"insurance":body.get("insurance",""),"insurance_id":body.get("insurance_id",""),"provider":body.get("provider","")}
    PATIENTS[pid] = p; return jsonify({"patient":p}), 201

@app.route("/patients", methods=["GET"])
def list_patients():
    return jsonify({"patients":list(PATIENTS.values()),"total":len(PATIENTS)}), 200

@app.route("/tickets", methods=["GET"])
def list_tickets():
    status = request.args.get("status"); urgency = request.args.get("urgency")
    items = tickets
    if status: items = [t for t in items if t["status"]==status]
    if urgency: items = [t for t in items if t["urgency"]==urgency]
    return jsonify({"tickets":sorted(items,key=lambda t:t["created_at"],reverse=True),"total":len(items)}), 200

@app.route("/tickets/<tid>", methods=["GET"])
def get_ticket(tid):
    for t in tickets:
        if t["ticket_id"]==tid: return jsonify(t), 200
    return jsonify({"error":"not found"}), 404

@app.route("/tickets/<tid>/complete", methods=["POST"])
def complete_ticket(tid):
    body = request.get_json(silent=True) or {}
    for t in tickets:
        if t["ticket_id"]==tid:
            t["status"]="complete"; t["completed_at"]=_now(); t["outcome"]=body.get("outcome","approved"); t["notes"]=body.get("notes","")
            if t.get("phone"):
                msg = {"approved":"Your insurance clearance has been approved. You're good to go.","denied":"Your insurance clearance was not approved. Please call your insurance provider.","needs_info":"We need additional information. Please call us back."}.get(t["outcome"],"Your clearance request has been updated.")
                send_sms(t["phone"], f"Pre-Visit Clearance: {msg} (ticket {tid})")
            return jsonify(t), 200
    return jsonify({"error":"not found"}), 404

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","active_calls":len(calls),"open_tickets":sum(1 for t in tickets if t["status"]=="open"),"patients":len(PATIENTS)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT, threaded=True)
