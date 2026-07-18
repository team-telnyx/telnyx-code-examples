#!/usr/bin/env python3
"""Hotel Guest Services Line.

Inbound voice calls are answered with Telnyx Call Control, then handed to a
configured Telnyx AI Assistant. Inbound SMS messages are categorized locally
with Telnyx AI Inference and tracked in memory.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any
from uuid import uuid4

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER", "")
TELNYX_ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
AI_MODEL = os.getenv("AI_MODEL", "openai/gpt-4o")
STAFF_SLACK_WEBHOOK = os.getenv("STAFF_SLACK_WEBHOOK", "")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

ROOMS = {
    "101": {"guest": "Smith", "phone": "+15559001234"},
    "205": {"guest": "Chen", "phone": "+15559005678"},
}

URGENT_PHRASES = (
    "fire",
    "smoke",
    "flood",
    "flooding",
    "leak",
    "leaking",
    "locked out",
    "lockout",
    "gas",
    "medical",
    "injury",
    "911",
)

service_requests: list[dict[str, Any]] = []
active_calls: dict[str, dict[str, Any]] = {}
processed_events: dict[str, float] = {}
conversation_events: list[dict[str, Any]] = []
EVENT_TTL_SECONDS = 3600


def _cleanup_loop() -> None:
    while True:
        time.sleep(300)
        cutoff = time.time() - EVENT_TTL_SECONDS
        for event_id, ts in list(processed_events.items()):
            if ts < cutoff:
                processed_events.pop(event_id, None)
        for call_control_id, call in list(active_calls.items()):
            if call.get("last_seen", 0) < cutoff:
                active_calls.pop(call_control_id, None)


threading.Thread(target=_cleanup_loop, daemon=True).start()


def _already_processed(event_id: str | None) -> bool:
    if not event_id:
        return False
    if event_id in processed_events:
        return True
    processed_events[event_id] = time.time()
    return False


def _verify_webhook() -> bool:
    if not TELNYX_PUBLIC_KEY:
        app.logger.warning("TELNYX_PUBLIC_KEY is not set; webhook signature verification skipped")
        return True
    try:
        telnyx_client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
        return True
    except Exception as exc:
        app.logger.warning("Invalid Telnyx webhook signature: %s", exc)
        return False


def _validate_call_control_id(call_control_id: str) -> str:
    if isinstance(call_control_id, str) and re.fullmatch(r"[A-Za-z0-9_:\-]{1,160}", call_control_id):
        return call_control_id
    app.logger.warning("Rejected malformed call_control_id: %r", call_control_id)
    return ""


def _validate_phone(phone: str) -> str:
    if isinstance(phone, str) and re.fullmatch(r"\+?[0-9]{1,20}", phone):
        return phone
    return ""


def _telnyx_post(path: str, body: dict[str, Any], timeout: int = 10) -> dict[str, Any] | None:
    url = f"{API}{path}"
    try:
        response = requests.post(url, headers=HEADERS, json=body, timeout=timeout)
        if response.status_code >= 400:
            app.logger.error("Telnyx command failed: %s -> %s", url, response.text[:500])
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        app.logger.error("Telnyx command error: %s -> %s", url, exc)
        return None


def answer_call(call_control_id: str) -> None:
    _telnyx_post(f"/calls/{call_control_id}/actions/answer", {})


def start_ai_assistant(call_control_id: str) -> dict[str, Any] | None:
    if not TELNYX_ASSISTANT_ID:
        app.logger.error("TELNYX_ASSISTANT_ID is required before starting the voice assistant")
        return None
    payload: dict[str, Any] = {
        "assistant": {"id": TELNYX_ASSISTANT_ID},
        "command_id": str(uuid4()),
        "send_message_history_updates": True,
    }
    return _telnyx_post(f"/calls/{call_control_id}/actions/ai_assistant_start", payload)


def send_sms(to: str, text: str) -> bool:
    if not MAIN_NUMBER or not to:
        return False
    return _telnyx_post("/messages", {"from": MAIN_NUMBER, "to": to, "text": text}) is not None


def slack_alert(text: str) -> None:
    if not STAFF_SLACK_WEBHOOK:
        return
    try:
        requests.post(STAFF_SLACK_WEBHOOK, json={"text": text}, timeout=5)
    except Exception as exc:
        app.logger.warning("Slack alert failed: %s", exc)


def room_from_caller(phone: str) -> str | None:
    for room, info in ROOMS.items():
        if info.get("phone") == phone:
            return room
    return None


def room_from_text(text: str) -> str | None:
    tokens = (
        text[:200]
        .replace("#", " ")
        .replace(",", " ")
        .replace(".", " ")
        .replace(":", " ")
        .replace(";", " ")
        .split()
    )
    for idx, token in enumerate(tokens[:-1]):
        if token.lower() not in {"room", "rm", "suite"}:
            continue
        room = tokens[idx + 1].strip()
        if 1 <= len(room) <= 12 and all(char.isalnum() or char == "-" for char in room):
            return room.upper()
    return None


def ai_categorize(text: str) -> dict[str, str]:
    fallback = {"department": "concierge", "urgency": "normal", "summary": text[:80]}
    try:
        response = requests.post(
            INFERENCE_URL,
            headers=HEADERS,
            json={
                "model": AI_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Categorize this hotel guest request. Return only JSON with "
                            "department (room_service|housekeeping|concierge|maintenance), "
                            "urgency (normal|urgent), and summary (80 characters or fewer)."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
                "max_tokens": 120,
                "temperature": 0.1,
            },
            timeout=15,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)
        return {
            "department": parsed.get("department", fallback["department"]),
            "urgency": parsed.get("urgency", fallback["urgency"]),
            "summary": (parsed.get("summary") or fallback["summary"])[:80],
        }
    except Exception as exc:
        app.logger.warning("AI categorization failed: %s", exc)
        return fallback


def detect_urgency(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in URGENT_PHRASES)


def record_request(room: str, guest: str, phone: str, channel: str, text: str) -> dict[str, Any]:
    result = ai_categorize(text)
    if detect_urgency(text):
        result["urgency"] = "urgent"
    req = {
        "id": len(service_requests),
        "room": room or "unknown",
        "guest": guest or "Guest",
        "phone": phone,
        "channel": channel,
        "department": result["department"],
        "urgency": result["urgency"],
        "summary": result["summary"],
        "original": text,
        "status": "open",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    service_requests.append(req)

    if phone:
        urgency_note = "staff has been alerted immediately." if req["urgency"] == "urgent" else "we will update you shortly."
        send_sms(phone, f"the grand hotel: your {req['department'].replace('_', ' ')} request #{req['id']} is logged. {urgency_note}")

    priority = "urgent" if req["urgency"] == "urgent" else "normal"
    slack_alert(f"{priority} hotel request #{req['id']} room {req['room']}: {req['department']} - {req['summary']}")
    return req


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    if not _verify_webhook():
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    event_id = data.get("id")
    if _already_processed(event_id):
        return jsonify({"status": "duplicate"}), 200

    event_type = data.get("event_type")
    event_payload = data.get("payload", {})
    call_control_id = _validate_call_control_id(event_payload.get("call_control_id", ""))
    if not call_control_id:
        return jsonify({"error": "invalid call_control_id"}), 400

    active_calls.setdefault(call_control_id, {"last_seen": time.time()})
    active_calls[call_control_id]["last_seen"] = time.time()

    if event_type == "call.initiated" and event_payload.get("direction") == "incoming":
        answer_call(call_control_id)
    elif event_type == "call.answered":
        active_calls[call_control_id]["assistant_started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        response = start_ai_assistant(call_control_id)
        if response and response.get("data", {}).get("conversation_id"):
            active_calls[call_control_id]["conversation_id"] = response["data"]["conversation_id"]
    elif event_type in ("call.conversation.ended", "call.conversation_insights.generated"):
        conversation_events.append(
            {
                "type": event_type,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "conversation_id": event_payload.get("conversation_id"),
            }
        )
    elif event_type == "call.hangup":
        active_calls.pop(call_control_id, None)

    return jsonify({"status": "ok"}), 200


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    if not _verify_webhook():
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    event_id = data.get("id")
    if _already_processed(event_id):
        return jsonify({"status": "duplicate"}), 200
    if data.get("event_type") != "message.received":
        return jsonify({"status": "ignored"}), 200

    event_payload = data.get("payload", {})
    sender = _validate_phone(event_payload.get("from", {}).get("phone_number", ""))
    text = (event_payload.get("text") or "").strip()
    if not sender or not text:
        return jsonify({"error": "missing sender or text"}), 400

    room = room_from_text(text) or room_from_caller(sender) or "unknown"
    guest = ROOMS.get(room, {}).get("guest", "Guest")
    req = record_request(room, guest, sender, "sms", text)
    return jsonify({"status": "ok", "request": req}), 200


@app.route("/requests", methods=["GET"])
def list_requests():
    department = request.args.get("department")
    status = request.args.get("status")
    items = service_requests
    if department:
        items = [item for item in items if item["department"] == department]
    if status:
        items = [item for item in items if item["status"] == status]
    return jsonify({"requests": items, "total": len(items)}), 200


@app.route("/requests/<int:idx>/complete", methods=["POST"])
def complete_request(idx: int):
    if idx < 0 or idx >= len(service_requests):
        return jsonify({"error": "not found"}), 404
    req = service_requests[idx]
    req["status"] = "completed"
    req["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    if req.get("phone"):
        send_sms(req["phone"], f"the grand hotel: your {req['department'].replace('_', ' ')} request #{req['id']} is complete.")
    return jsonify({"request": req}), 200


@app.route("/events", methods=["GET"])
def list_events():
    labels = {
        "call.conversation.ended": "conversation ended",
        "call.conversation_insights.generated": "insights generated",
    }
    events = [
        {
            "type": labels.get(item["type"], "call activity"),
            "created_at": item["created_at"],
        }
        for item in conversation_events[-50:]
    ]
    return jsonify({"events": events, "total": len(conversation_events)}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "assistant_configured": bool(TELNYX_ASSISTANT_ID),
            "active_calls": len(active_calls),
            "open_requests": sum(1 for item in service_requests if item["status"] == "open"),
        }
    ), 200


@app.route("/", methods=["GET"])
def dashboard():
    phone_number = MAIN_NUMBER or "not configured"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hotel Guest Services Line</title>
  <style>
    body {{ margin: 0; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172026; background: #f6f7f2; }}
    header {{ padding: 28px 32px 18px; background: #15362f; color: white; }}
    h1 {{ margin: 0 0 6px; font-size: 30px; }}
    main {{ display: grid; grid-template-columns: 320px 1fr; gap: 18px; padding: 18px 32px 32px; }}
    section {{ background: white; border: 1px solid #d9ded6; border-radius: 8px; padding: 16px; }}
    .stat {{ display: flex; justify-content: space-between; border-bottom: 1px solid #edf0eb; padding: 10px 0; gap: 14px; }}
    .stat:last-child {{ border-bottom: 0; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 10px; border-bottom: 1px solid #edf0eb; text-align: left; vertical-align: top; }}
    th {{ font-size: 12px; text-transform: uppercase; color: #5e6b64; }}
    .pill {{ display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e8f2ee; color: #15362f; font-size: 12px; }}
    code {{ background: #eef1ec; padding: 2px 5px; border-radius: 4px; }}
    @media (max-width: 820px) {{ main {{ grid-template-columns: 1fr; padding: 14px; }} header {{ padding: 22px 14px 14px; }} }}
  </style>
</head>
<body>
  <header>
    <h1>Hotel Guest Services Line</h1>
    <div>Live guest services calls and SMS requests appear here.</div>
  </header>
  <main>
    <section>
      <h2>Status</h2>
      <div class="stat"><span>Service</span><strong id="status">checking</strong></div>
      <div class="stat"><span>Phone number</span><code>{phone_number}</code></div>
      <div class="stat"><span>Assistant ready</span><strong id="assistant">checking</strong></div>
      <div class="stat"><span>Active calls</span><strong id="calls">0</strong></div>
      <div class="stat"><span>Open requests</span><strong id="open">0</strong></div>
    </section>
    <section>
      <h2>Recent Activity</h2>
      <table>
        <thead><tr><th>Time</th><th>Type</th></tr></thead>
        <tbody id="events"><tr><td colspan="2">No recent activity.</td></tr></tbody>
      </table>
    </section>
    <section style="grid-column: 1 / -1;">
      <h2>Open Requests</h2>
      <table>
        <thead><tr><th>Room</th><th>Department</th><th>Urgency</th><th>Summary</th><th>Channel</th><th>Status</th></tr></thead>
        <tbody id="requests"><tr><td colspan="6">No open requests.</td></tr></tbody>
      </table>
    </section>
  </main>
  <script>
    function escapeHtml(value) {{
      return String(value ?? '').replace(/[&<>"']/g, c => ({{'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}}[c]));
    }}
    async function refresh() {{
      const health = await fetch('/health').then(r => r.json());
      const events = await fetch('/events').then(r => r.json());
      const requests = await fetch('/requests?status=open').then(r => r.json());
      document.getElementById('status').textContent = health.status;
      document.getElementById('assistant').textContent = health.assistant_configured ? 'yes' : 'no';
      document.getElementById('calls').textContent = health.active_calls;
      document.getElementById('open').textContent = health.open_requests;
      const rows = events.events.slice().reverse().map(e => `<tr><td>${{escapeHtml(e.created_at)}}</td><td><span class="pill">${{escapeHtml(e.type)}}</span></td></tr>`);
      document.getElementById('events').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="2">No recent activity.</td></tr>';
      const requestRows = requests.requests.slice().reverse().map(r => `<tr><td>${{escapeHtml(r.room)}}</td><td>${{escapeHtml(r.department.replace('_', ' '))}}</td><td><span class="pill">${{escapeHtml(r.urgency)}}</span></td><td>${{escapeHtml(r.summary)}}</td><td>${{escapeHtml(r.channel)}}</td><td>${{escapeHtml(r.status)}}</td></tr>`);
      document.getElementById('requests').innerHTML = requestRows.length ? requestRows.join('') : '<tr><td colspan="6">No open requests.</td></tr>';
    }}
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>"""


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT, threaded=True)
