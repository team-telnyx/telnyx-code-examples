#!/usr/bin/env python3
"""Lab results notification voice assistant for HIPAA-compliant workflows."""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template_string, request

load_dotenv()

app = Flask(__name__)

API_BASE = "https://api.telnyx.com/v2"
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER", "")
FRONT_DESK_NUMBER = os.getenv("FRONT_DESK_NUMBER", "")
ON_CALL_NURSE_NUMBER = os.getenv("ON_CALL_NURSE_NUMBER", "")
TOOL_SECRET = os.getenv("TOOL_SECRET", "")
RESULTS_PORTAL_BASE_URL = os.getenv("RESULTS_PORTAL_BASE_URL", "https://portal.example.com/r")
BUSINESS_HOURS_START = os.getenv("BUSINESS_HOURS_START", "08:00")
BUSINESS_HOURS_END = os.getenv("BUSINESS_HOURS_END", "17:00")

HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

DATA_PATH = Path(__file__).parent / "data" / "patients.json"
PATIENTS: dict[str, dict[str, Any]] = json.loads(DATA_PATH.read_text())

active_calls: dict[str, dict[str, Any]] = {}
verification_attempts: dict[str, int] = {}
audit_events: list[dict[str, Any]] = []
callback_queue: list[dict[str, Any]] = []

DASHBOARD_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lab Results Voice Assistant</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f9;
      --panel: #ffffff;
      --ink: #172026;
      --muted: #5f6f7a;
      --line: #dbe3e8;
      --accent: #00a4b8;
      --accent-dark: #00798a;
      --ok: #237a4b;
      --warn: #a65d00;
      --bad: #b42318;
      --soft: #eef7f8;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }

    header {
      background: #101820;
      color: #ffffff;
      padding: 28px 32px;
    }

    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 24px 40px;
    }

    h1, h2, h3, p {
      margin-top: 0;
    }

    h1 {
      font-size: 30px;
      line-height: 1.15;
      margin-bottom: 8px;
      letter-spacing: 0;
    }

    h2 {
      font-size: 18px;
      margin-bottom: 14px;
    }

    h3 {
      font-size: 15px;
      margin-bottom: 8px;
    }

    .subhead {
      color: #c8d4da;
      max-width: 760px;
      margin-bottom: 18px;
    }

    .topline {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 999px;
      padding: 5px 10px;
      color: #ffffff;
      font-size: 13px;
      white-space: nowrap;
    }

    .grid {
      display: grid;
      gap: 16px;
    }

    .grid.two {
      grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
    }

    .grid.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 1px 2px rgba(16, 24, 32, 0.04);
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .flow {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      min-height: 106px;
      background: #fbfdfe;
    }

    .step-number {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent);
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 8px;
    }

    .muted {
      color: var(--muted);
    }

    .small {
      font-size: 13px;
    }

    .patient {
      display: grid;
      gap: 10px;
    }

    .patient-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .tag {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      white-space: nowrap;
    }

    .tag.normal {
      color: var(--ok);
      background: #e7f5ee;
    }

    .tag.borderline {
      color: var(--warn);
      background: #fff3df;
    }

    .tag.abnormal {
      color: var(--bad);
      background: #fdecea;
    }

    dl {
      display: grid;
      grid-template-columns: 100px 1fr;
      gap: 6px 10px;
      margin: 0;
    }

    dt {
      color: var(--muted);
    }

    dd {
      margin: 0;
      font-weight: 600;
    }

    ul {
      padding-left: 20px;
      margin: 0;
    }

    li + li {
      margin-top: 8px;
    }

    .script {
      background: var(--soft);
      border-left: 4px solid var(--accent);
      padding: 12px;
      border-radius: 6px;
      color: #173c43;
    }

    .status-list {
      display: grid;
      gap: 10px;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 10px;
    }

    .status-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent-dark);
      margin-right: 8px;
    }

    .empty {
      min-height: 70px;
      display: grid;
      place-items: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fbfdfe;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.95em;
    }

    @media (max-width: 920px) {
      .grid.two,
      .grid.three,
      .flow {
        grid-template-columns: 1fr;
      }

      header {
        padding: 24px 20px;
      }

      main {
        padding: 20px 16px 32px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Lab Results Voice Assistant</h1>
    <p class="subhead">A screen-share dashboard for the Telnyx AI Assistant demo. All patient records shown here are mock data.</p>
    <div class="topline">
      <span class="pill">assistant {{ assistant_status }}</span>
      <span class="pill">phone number assigned</span>
      <span class="pill">recording off</span>
      <span class="pill">retention off</span>
      <span class="pill">native sms link</span>
    </div>
  </header>

  <main class="stack">
    <section class="grid two">
      <div class="panel">
        <h2>Call Flow</h2>
        <div class="flow">
          {% for step in flow_steps %}
          <div class="step">
            <div class="step-number">{{ loop.index }}</div>
            <h3>{{ step.title }}</h3>
            <p class="muted small">{{ step.description }}</p>
          </div>
          {% endfor %}
        </div>
      </div>

      <div class="panel">
        <h2>Screen-Share Talk Track</h2>
        <div class="script small">
          {{ talk_track }}
        </div>
      </div>
    </section>

    <section class="grid two">
      <div class="panel">
        <h2>Mock Test Patients</h2>
        <div class="grid three">
          {% for patient in patients %}
          <article class="panel patient">
            <div class="patient-head">
              <div>
                <h3>{{ patient.name }}</h3>
                <p class="muted small">{{ patient.panel }} on {{ patient.date }}</p>
              </div>
              <span class="tag {{ patient.urgency }}">{{ patient.urgency }}</span>
            </div>
            <dl class="small">
              <dt>dob</dt>
              <dd>{{ patient.dob }}</dd>
              <dt>phone</dt>
              <dd>{{ patient.phone }}</dd>
              <dt>result</dt>
              <dd>{{ patient.result }}</dd>
            </dl>
            <p class="muted small">{{ patient.note }}</p>
          </article>
          {% endfor %}
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <h2>HIPAA Compliance Safeguards</h2>
          <ul class="small">
            {% for item in safeguards %}
            <li>{{ item }}</li>
            {% endfor %}
          </ul>
        </div>

        <div class="panel">
          <h2>Local Runtime</h2>
          <div class="status-list small">
            <div class="status-row"><span><span class="dot"></span>active calls</span><strong>{{ active_call_count }}</strong></div>
            <div class="status-row"><span><span class="dot"></span>audit events</span><strong>{{ audit_count }}</strong></div>
            <div class="status-row"><span><span class="dot"></span>callback queue</span><strong>{{ callback_count }}</strong></div>
          </div>
        </div>
      </div>
    </section>

    <section class="grid two">
      <div class="panel">
        <h2>Recent Audit Events</h2>
        {% if audit_events %}
        <ul class="small">
          {% for event in audit_events %}
          <li><code>{{ event.created_at }}</code> {{ event.event_type }}</li>
          {% endfor %}
        </ul>
        {% else %}
        <div class="empty small">no local audit events yet</div>
        {% endif %}
      </div>

      <div class="panel">
        <h2>Queued Callbacks</h2>
        {% if callbacks %}
        <ul class="small">
          {% for callback in callbacks %}
          <li><code>{{ callback.created_at }}</code> {{ callback.patient_id }} {{ callback.status }}</li>
          {% endfor %}
        </ul>
        {% else %}
        <div class="empty small">no callback requests yet</div>
        {% endif %}
      </div>
    </section>
  </main>
</body>
</html>
"""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z ]", "", value.lower()).strip()


def normalize_dob(value: str) -> str:
    value = value.strip().lower()
    value = value.replace(",", "")
    value = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", value)
    value = value.replace("/", "-")
    for fmt in ("%Y-%m-%d", "%m-%d-%Y", "%B %d %Y", "%b %d %Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return value


def body_text(body: dict[str, Any]) -> str:
    parts = []
    for value in body.values():
        if isinstance(value, str):
            parts.append(value)
    return " ".join(parts)


def candidate_name(body: dict[str, Any]) -> str:
    for key in ("full_name", "patient_name", "name", "caller_name"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value
    text = normalize_name(body_text(body))
    for patient in PATIENTS.values():
        if normalize_name(patient["name"]) in text:
            return patient["name"]
    return ""


def candidate_dob(body: dict[str, Any]) -> str:
    for key in ("date_of_birth", "dob", "birth_date", "patient_dob"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value
    text = body_text(body)
    numeric = re.search(r"\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b", text)
    if numeric:
        return numeric.group(0)
    month = re.search(
        r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b",
        text,
        re.IGNORECASE,
    )
    if month:
        return month.group(0)
    return ""


def mask_phone(value: Optional[str]) -> str:
    if not value:
        return ""
    digits = "".join(ch for ch in value if ch.isdigit())
    return f"+***{digits[-4:]}" if len(digits) >= 4 else "****"


def mask_name(value: str) -> str:
    parts = value.split()
    if not parts:
        return ""
    return f"{parts[0][0]}*** {parts[-1][0]}***"


def latest_result(patient: dict[str, Any]) -> dict[str, Any]:
    return sorted(patient["results"], key=lambda item: item["date"], reverse=True)[0]


def is_business_hours() -> bool:
    now = datetime.now().strftime("%H:%M")
    return BUSINESS_HOURS_START <= now <= BUSINESS_HOURS_END


def dashboard_patients() -> list[dict[str, str]]:
    rows = []
    for patient in PATIENTS.values():
        result = latest_result(patient)
        rows.append(
            {
                "name": patient["name"],
                "dob": patient["dob"],
                "phone": mask_phone(patient["phone"]),
                "panel": result["panel"],
                "date": result["date"],
                "urgency": result["urgency"],
                "result": result["plain_language_summary"],
                "note": result["provider_note"],
            }
        )
    return sorted(rows, key=lambda item: item["name"])


def audit(event_type: str, **details: Any) -> None:
    audit_events.append(
        {
            "event_id": f"audit-{uuid.uuid4().hex[:10]}",
            "event_type": event_type,
            "created_at": now_iso(),
            **details,
        }
    )


@app.route("/", methods=["GET"])
def dashboard():
    flow_steps = [
        {
            "title": "Call",
                "description": "the patient calls the telnyx number assigned directly to the ai assistant.",
        },
        {
            "title": "Verify",
                "description": "the assistant asks for legal name and date of birth before result disclosure.",
        },
        {
            "title": "Disclose",
                "description": "the assistant gives the minimum necessary mock result summary and provider note.",
        },
        {
            "title": "Follow up",
                "description": "normal results can receive a secure portal link. abnormal results get callback guidance.",
        },
    ]
    safeguards = [
        "mock records only, with no real ehr access in the demo",
        "identity verification before any lab result summary",
        "minimum necessary spoken disclosure",
        "sms contains a secure portal link, not lab values",
        "assistant recording and data retention are disabled",
        "local audit display avoids raw transcripts and full phone numbers",
    ]
    talk_track = (
        "this demo shows a hipaa-aware lab results notification flow. the assistant verifies identity, "
        "shares only the minimum necessary result summary, and can send a secure portal link by sms without "
        "putting lab values in the text message."
    )
    return render_template_string(
        DASHBOARD_TEMPLATE,
        assistant_status="configured" if TELNYX_ASSISTANT_ID else "not configured",
        patients=dashboard_patients(),
        flow_steps=flow_steps,
        safeguards=safeguards,
        talk_track=talk_track,
        active_call_count=len(active_calls),
        audit_count=len(audit_events),
        callback_count=len(callback_queue),
        audit_events=audit_events[-8:],
        callbacks=callback_queue[-8:],
    )


def find_patient(full_name: str, date_of_birth: str) -> Optional[dict[str, Any]]:
    target_name = normalize_name(full_name)
    target_dob = normalize_dob(date_of_birth)
    for patient in PATIENTS.values():
        patient_name = normalize_name(patient["name"])
        name_matches = patient_name == target_name or patient_name in target_name
        if name_matches and patient["dob"] == target_dob:
            return patient
    return None


def find_patient_from_body(body: dict[str, Any]) -> Optional[dict[str, Any]]:
    return find_patient(candidate_name(body), candidate_dob(body))


def require_tool_secret() -> tuple[Optional[dict[str, str]], Optional[int]]:
    if not TOOL_SECRET:
        return None, None
    incoming = request.headers.get("X-Lab-Results-Tool-Secret")
    if incoming != TOOL_SECRET:
        return {"error": "unauthorized"}, 401
    return None, None


def verify_telnyx_webhook() -> bool:
    if not TELNYX_PUBLIC_KEY:
        app.logger.warning("TELNYX_PUBLIC_KEY is unset; skipping webhook signature verification")
        return True
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
        return True
    except Exception as exc:
        app.logger.warning("webhook signature verification failed: %s", exc)
        return False


def telnyx_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(f"{API_BASE}{path}", headers=HEADERS, json=body, timeout=15)
    response.raise_for_status()
    return response.json()


def start_assistant(call_control_id: str) -> dict[str, Any]:
    if not TELNYX_ASSISTANT_ID:
        raise RuntimeError("TELNYX_ASSISTANT_ID is required")
    return telnyx_post(f"/calls/{call_control_id}/actions/ai_assistant_start", {"assistant": {"id": TELNYX_ASSISTANT_ID}})


def send_sms(to_number: str, text: str) -> None:
    if not TELNYX_PHONE_NUMBER:
        app.logger.info("TELNYX_PHONE_NUMBER unset; skipping sms")
        return
    telnyx_post("/messages", {"from": TELNYX_PHONE_NUMBER, "to": to_number, "text": text})


def transfer_call(call_control_id: str, to_number: str) -> Optional[dict[str, Any]]:
    if not call_control_id or not to_number:
        return None
    return telnyx_post(f"/calls/{call_control_id}/actions/transfer", {"to": to_number})


@app.route("/webhooks/voice", methods=["POST"])
def voice_webhook():
    if not verify_telnyx_webhook():
        return jsonify({"error": "invalid signature"}), 401

    event = request.get_json(silent=True) or {}
    data = event.get("data", {})
    payload = data.get("payload", {})
    event_type = data.get("event_type")
    call_control_id = payload.get("call_control_id")

    if event_type == "call.initiated" and payload.get("direction") == "incoming":
        telnyx_post(f"/calls/{call_control_id}/actions/answer", {})
        return jsonify({"status": "answered"}), 200

    if event_type == "call.answered" and call_control_id:
        result = start_assistant(call_control_id)
        active_calls[call_control_id] = {
            "caller_masked": mask_phone(payload.get("from")),
            "started_at": now_iso(),
            "assistant_id": TELNYX_ASSISTANT_ID,
            "conversation_id": result.get("data", {}).get("conversation_id"),
        }
        return jsonify({"status": "assistant_started", "assistant_id": TELNYX_ASSISTANT_ID}), 200

    if event_type in {"call.hangup", "call.conversation.ended"} and call_control_id:
        active_calls.pop(call_control_id, None)
        verification_attempts.pop(call_control_id, None)
        return jsonify({"status": "closed"}), 200

    return jsonify({"status": "ignored", "event_type": event_type}), 200


@app.route("/tools/verify_patient_identity", methods=["POST"])
def verify_patient_identity():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    call_key = body.get("caller_phone") or "unknown"
    attempts = verification_attempts.get(call_key, 0) + 1
    verification_attempts[call_key] = attempts

    patient = find_patient_from_body(body)
    if not patient:
        audit(
            "verification_failed",
            caller_masked=mask_phone(body.get("caller_phone")),
            attempts=attempts,
            input_keys=sorted(body.keys()),
            parsed_name=bool(candidate_name(body)),
            parsed_dob=bool(candidate_dob(body)),
        )
        return jsonify({"verified": False, "attempts": attempts, "max_attempts_reached": attempts >= 3}), 200

    verification_attempts.pop(call_key, None)
    audit("verification_succeeded", patient_id=patient["patient_id"], caller_masked=mask_phone(body.get("caller_phone")))
    return jsonify(
        {
            "verified": True,
            "patient_id": patient["patient_id"],
            "patient_display_name": mask_name(patient["name"]),
            "caller_phone": patient["phone"],
        }
    ), 200


@app.route("/tools/get_latest_lab_result", methods=["POST"])
def get_latest_lab_result():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    patient = next((item for item in PATIENTS.values() if item["patient_id"] == body.get("patient_id")), None)
    if not patient:
        return jsonify({"error": "patient_id not found"}), 404

    result = latest_result(patient)
    audit("result_summary_disclosed", patient_id=patient["patient_id"], result_id=result["result_id"], urgency=result["urgency"])
    return jsonify(
        {
            "patient_id": patient["patient_id"],
            "result_id": result["result_id"],
            "panel": result["panel"],
            "date": result["date"],
            "urgency": result["urgency"],
            "plain_language_summary": result["plain_language_summary"],
            "provider_note": result["provider_note"],
            "business_hours": is_business_hours(),
        }
    ), 200


@app.route("/tools/send_secure_results_link", methods=["POST"])
def send_secure_results_link():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    patient = next((item for item in PATIENTS.values() if item["patient_id"] == body.get("patient_id")), None)
    if not patient:
        return jsonify({"error": "patient_id not found"}), 404

    token = uuid.uuid4().hex
    link = f"{RESULTS_PORTAL_BASE_URL.rstrip('/')}/{token}"
    send_sms(patient["phone"], f"{os.getenv('CLINIC_NAME', 'telnyx health')}: your results are ready. view securely: {link} expires in 24 hours.")
    audit("secure_link_sent", patient_id=patient["patient_id"], phone_masked=mask_phone(patient["phone"]))
    return jsonify({"status": "sent", "expires_in_hours": 24}), 200


@app.route("/tools/warm_transfer_to_nurse", methods=["POST"])
def warm_transfer_to_nurse():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    audit(
        "nurse_transfer_requested",
        patient_id=body.get("patient_id"),
        result_id=body.get("result_id"),
        minimum_context=body.get("minimum_context", ""),
    )
    transfer_result = transfer_call(body.get("call_control_id", ""), ON_CALL_NURSE_NUMBER)
    return jsonify(
        {
            "status": "transferred" if transfer_result else "transfer_ready",
            "transfer_to": ON_CALL_NURSE_NUMBER,
            "whisper": body.get("minimum_context", ""),
        }
    ), 200


@app.route("/tools/queue_after_hours_callback", methods=["POST"])
def queue_after_hours_callback():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    callback = {
        "callback_id": f"callback-{uuid.uuid4().hex[:10]}",
        "patient_id": body.get("patient_id"),
        "result_id": body.get("result_id"),
        "minimum_context": body.get("minimum_context", ""),
        "callback_window": "within 30 minutes",
        "created_at": now_iso(),
        "status": "queued",
    }
    callback_queue.append(callback)
    audit("after_hours_callback_queued", patient_id=callback["patient_id"], result_id=callback["result_id"])
    return jsonify(callback), 201


@app.route("/tools/transfer_to_front_desk", methods=["POST"])
def transfer_to_front_desk():
    error, status = require_tool_secret()
    if error:
        return jsonify(error), status

    body = request.get_json(silent=True) or {}
    audit("front_desk_transfer_requested", reason=body.get("reason", ""), caller_masked=mask_phone(body.get("caller_phone")))
    transfer_result = transfer_call(body.get("call_control_id", ""), FRONT_DESK_NUMBER)
    return jsonify({"status": "transferred" if transfer_result else "transfer_ready", "transfer_to": FRONT_DESK_NUMBER}), 200


@app.route("/dynamic-variables", methods=["POST"])
def dynamic_variables():
    return jsonify(
        {
            "dynamic_variables": {
                "clinic_name": os.getenv("CLINIC_NAME", "telnyx health"),
                "front_desk_number": FRONT_DESK_NUMBER,
                "on_call_nurse_number": ON_CALL_NURSE_NUMBER,
            }
        }
    ), 200


@app.route("/results/audit", methods=["GET"])
def list_audit_events():
    public_events = [{k: v for k, v in item.items() if k not in {"minimum_context"}} for item in audit_events[-50:]]
    return jsonify({"audit_events": public_events}), 200


@app.route("/results/callbacks", methods=["GET"])
def list_callbacks():
    return jsonify({"callbacks": callback_queue[-50:]}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "assistant_configured": bool(TELNYX_ASSISTANT_ID),
            "active_calls": len(active_calls),
            "callback_queue": len(callback_queue),
        }
    ), 200


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
