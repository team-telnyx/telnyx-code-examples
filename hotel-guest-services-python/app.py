#!/usr/bin/env python3
"""Hotel Guest Services Line.

Inbound voice + SMS concierge for a hotel. Routes room service, housekeeping,
concierge, and maintenance requests, escalates urgent ones, and notifies staff
via Slack.

State is in-memory (dict/list) — fine for a single-process demo.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER", "")
CONNECTION_ID = os.getenv("CONNECTION_ID", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
TTS_VOICE = os.getenv("TTS_VOICE", "AWS.Polly.Joanna-Neural")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "en-US")
STAFF_SLACK_WEBHOOK = os.getenv("STAFF_SLACK_WEBHOOK", "")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

ROOMS: dict[str, dict[str, str]] = {
    "101": {"guest": "Smith", "phone": "+15559001234"},
    "205": {"guest": "Chen", "phone": "+15559005678"},
}

URGENT_PHRASES = (
    "fire", "smoke", "flood", "flooding", "leak", "leaking",
    "locked out", "lockout", "can't get in", "no power", "no heat",
    "gas", "smell of gas", "medical", "injury", "hurt", "911",
)

service_requests: list[dict[str, Any]] = []
calls: dict[str, dict[str, Any]] = {}
processed_events: dict[str, float] = {}
EVENT_TTL = 3600


def _ttl_cleanup_loop() -> None:
    while True:
        time.sleep(300)
        cutoff = time.time() - EVENT_TTL
        expired = [k for k, v in processed_events.items() if v < cutoff]
        for k in expired:
            processed_events.pop(k, None)
        expired_calls = [k for k, v in calls.items() if v.get("last_seen", 0) < cutoff]
        for k in expired_calls:
            calls.pop(k, None)


threading.Thread(target=_ttl_cleanup_loop, daemon=True).start()


def _already_processed(event_id: str | None) -> bool:
    if not event_id:
        return False
    now = time.time()
    if event_id in processed_events:
        return True
    processed_events[event_id] = now
    return False


def _verify_webhook() -> bool:
    if not TELNYX_PUBLIC_KEY:
        return True
    try:
        telnyx_client.webhooks.unwrap(
            request.get_data(as_text=True), headers=dict(request.headers)
        )
        return True
    except Exception:
        return False


def _post(url: str, body: dict[str, Any], timeout: int = 10) -> dict[str, Any] | None:
    try:
        resp = requests.post(url, headers=HEADERS, json=body, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        app.logger.warning("Telnyx POST %s failed: %s", url, exc)
        return None


def _validate_ccid(ccid: str) -> str:
    """Validate Telnyx call_control_id format to prevent SSRF.

    Telnyx call_control_id always looks like ``v3:<base64-ish>``.
    Reject anything that doesn't match the expected shape so an attacker
    can't use a forged webhook to point our outbound calls at an
    arbitrary URL path.
    """
    if not ccid or not isinstance(ccid, str):
        return ""
    if not re.match(r"^[A-Za-z0-9_\-:]{1,128}$", ccid):
        app.logger.warning("Rejected malformed call_control_id: %r", ccid)
        return ""
    return ccid


def _validate_phone(phone: str) -> str:
    """Validate E.164-ish phone number format to prevent SSRF/HTTP injection."""
    if not phone or not isinstance(phone, str):
        return ""
    if not re.match(r"^\+?[0-9]{1,20}$", phone):
        return ""
    return phone


def send_sms(to: str, text: str) -> bool:
    if not to:
        return False
    payload = {"from": MAIN_NUMBER, "to": to, "text": text}
    result = _post(f"{API}/messages", payload, timeout=10)
    return result is not None


def slack_alert(text: str) -> None:
    if not STAFF_SLACK_WEBHOOK:
        return
    try:
        requests.post(STAFF_SLACK_WEBHOOK, json={"text": text}, timeout=5)
    except Exception as exc:
        app.logger.warning("Slack alert failed: %s", exc)


def ai_categorize(text: str) -> dict[str, Any]:
    fallback = {
        "department": "concierge",
        "urgency": "normal",
        "summary": text[:120],
        "details": text[:240],
    }
    try:
        resp = requests.post(
            INFERENCE_URL,
            headers=HEADERS,
            json={
                "model": AI_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Categorize this hotel guest request. "
                            "Return ONLY JSON with keys: "
                            "department (room_service|housekeeping|concierge|maintenance), "
                            "urgency (normal|urgent), "
                            "summary (one short line, <= 80 chars), "
                            "details (the actionable item, <= 240 chars)."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
                "max_tokens": 200,
                "temperature": 0.1,
            },
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)
        return {
            "department": parsed.get("department", fallback["department"]),
            "urgency": parsed.get("urgency", fallback["urgency"]),
            "summary": (parsed.get("summary") or fallback["summary"])[:120],
            "details": (parsed.get("details") or text[:240])[:240],
        }
    except Exception:
        return fallback


def detect_urgency(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in URGENT_PHRASES)


def room_from_caller(phone: str) -> str | None:
    if not phone:
        return None
    for room, info in ROOMS.items():
        if info.get("phone") == phone:
            return room
    return None


def extract_room_number(text: str) -> str | None:
    match = re.search(r"\b(?:room\s*)?(\d{2,4})\b", text.lower())
    if match:
        room = match.group(1)
        if room in ROOMS:
            return room
    return None


def record_request(
    room: str, guest: str, phone: str, channel: str, text: str
) -> dict[str, Any]:
    result = ai_categorize(text)
    if detect_urgency(text) and result["urgency"] != "urgent":
        result["urgency"] = "urgent"
    req = {
        "id": len(service_requests),
        "room": room or "unknown",
        "guest": guest or "Guest",
        "phone": phone or "",
        "channel": channel,
        "department": result["department"],
        "urgency": result["urgency"],
        "summary": result["summary"],
        "details": result["details"],
        "original": text,
        "status": "open",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    service_requests.append(req)

    if req["phone"]:
        urgent_note = "URGENT — staff dispatched immediately." if req["urgency"] == "urgent" else "We'll update you shortly."
        send_sms(
            req["phone"],
            f"Thanks {req['guest']}, your {req['department'].replace('_', ' ')} request "
            f"#{req['id']} is logged. {urgent_note}",
        )

    if req["urgency"] == "urgent":
        slack_alert(
            f":rotating_light: URGENT Room {req['room']} ({req['guest']}): "
            f"{req['department']} — {req['summary']}"
        )
    elif req["department"] == "maintenance":
        slack_alert(
            f":wrench: Room {req['room']} ({req['guest']}): "
            f"{req['department']} — {req['summary']}"
        )
    elif req["department"] == "housekeeping":
        slack_alert(
            f":broom: Room {req['room']} ({req['guest']}): {req['summary']}"
        )
    elif req["department"] == "room_service":
        slack_alert(
            f":knife_fork_plate: Room {req['room']} ({req['guest']}): {req['summary']}"
        )
    else:
        slack_alert(
            f":bell: Room {req['room']} ({req['guest']}): {req['summary']}"
        )
    return req


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    if not _verify_webhook():
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    event_id = payload.get("data", {}).get("id")
    if _already_processed(event_id):
        return jsonify({"status": "duplicate"}), 200
    data = payload.get("data", {}).get("payload", {})
    sender = _validate_phone(data.get("from", {}).get("phone_number", ""))
    text = data.get("text", "")
    room = room_from_caller(sender)
    guest = ROOMS.get(room, {}).get("guest") if room else None
    record_request(room or "unknown", guest or "Guest", sender, "sms", text)
    return jsonify({"status": "ok"}), 200


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    if not _verify_webhook():
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    event_id = payload.get("data", {}).get("id")
    if _already_processed(event_id):
        return jsonify({"status": "duplicate"}), 200

    data = payload.get("data", {})
    p = data.get("payload", {})
    event = data.get("event_type")
    ccid = _validate_ccid(p.get("call_control_id", ""))
    caller = _validate_phone(p.get("from", ""))
    if not ccid:
        return jsonify({"error": "invalid call_control_id"}), 400
    calls.setdefault(ccid, {"caller": caller, "room": None, "history": [], "last_seen": time.time()})
    calls[ccid]["last_seen"] = time.time()

    if event == "call.initiated" and p.get("direction") == "incoming":
        _post(f"{API}/calls/{ccid}/actions/answer", {})
    elif event == "call.answered":
        room = room_from_caller(caller)
        calls[ccid]["room"] = room
        if room:
            greeting = f"Good evening, {ROOMS[room]['guest']}! How may I help you today?"
        else:
            greeting = "Welcome to The Grand Hotel. May I have your room number, please?"
        _post(
            f"{API}/calls/{ccid}/actions/speak",
            {"payload": greeting, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
        )
    elif event == "call.speak.ended":
        _post(
            f"{API}/calls/{ccid}/actions/gather",
            {
                "input_type": "speech",
                "end_silence_timeout_secs": 2,
                "timeout_secs": 20,
                "language_code": "en-US",
            },
        )
    elif event == "call.gather.ended":
        speech = (p.get("speech") or {}).get("result", "").strip()
        call = calls.get(ccid, {})
        if not speech:
            _post(
                f"{API}/calls/{ccid}/actions/speak",
                {
                    "payload": "Sorry, I didn't catch that. Could you say it again?",
                    "voice": TTS_VOICE,
                    "language_code": TTS_LANGUAGE,
                },
            )
            return jsonify({"status": "reprompt"}), 200

        if not call.get("room"):
            detected_room = extract_room_number(speech)
            if detected_room:
                call["room"] = detected_room
                guest = ROOMS[detected_room]["guest"]
                reply = f"Thank you, room {detected_room} ({guest}). How may I help you?"
            else:
                reply = "I couldn't find your room. Could you repeat your room number?"
            _post(
                f"{API}/calls/{ccid}/actions/speak",
                {"payload": reply, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
            )
            return jsonify({"status": "collecting_room"}), 200

        room = call["room"]
        guest = ROOMS.get(room, {}).get("guest", "Guest")
        record_request(room, guest, caller, "voice", speech)
        confirm = (
            f"Thanks {guest}. Your request has been logged. "
            "We'll send you a text confirmation now."
        )
        _post(
            f"{API}/calls/{ccid}/actions/speak",
            {"payload": confirm, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
        )
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200


@app.route("/requests", methods=["GET"])
def list_requests():
    dept = request.args.get("department")
    status = request.args.get("status")
    items = service_requests
    if dept:
        items = [r for r in items if r["department"] == dept]
    if status:
        items = [r for r in items if r["status"] == status]
    return jsonify({"requests": items, "total": len(items)}), 200


@app.route("/requests/<int:idx>/complete", methods=["POST"])
def complete_request(idx: int):
    if idx < 0 or idx >= len(service_requests):
        return jsonify({"error": "not found"}), 404
    req = service_requests[idx]
    req["status"] = "completed"
    req["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    if req.get("phone"):
        send_sms(
            req["phone"],
            f"The Grand Hotel: your {req['department'].replace('_', ' ')} request "
            f"#{req['id']} is complete. Text us if you need anything else.",
        )
    return jsonify({"request": req}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "open_requests": sum(1 for r in service_requests if r["status"] == "open"),
            "active_calls": len(calls),
        }
    ), 200


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT)
