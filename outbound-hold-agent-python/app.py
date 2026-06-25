#!/usr/bin/env python3
"""Outbound hold-aware Telnyx AI voice agent example."""

import base64
import html
import io
import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qs, quote
from uuid import uuid4
import wave

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
import uvicorn

load_dotenv()

API_BASE = "https://api.telnyx.com/v2"
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_CONNECTION_ID = os.getenv("TELNYX_CONNECTION_ID", "")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "")
TELNYX_IVR_ASSISTANT_ID = os.getenv("TELNYX_IVR_ASSISTANT_ID", "")
TELNYX_REPRESENTATIVE_ASSISTANT_ID = os.getenv("TELNYX_REPRESENTATIVE_ASSISTANT_ID", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
TRANSCRIPTION_ENGINE = os.getenv("TRANSCRIPTION_ENGINE", "Deepgram")
TRANSCRIPTION_MODEL = os.getenv("TRANSCRIPTION_MODEL", "nova-2")
TRANSCRIPTION_LANGUAGE = os.getenv("TRANSCRIPTION_LANGUAGE", "en")
START_TRANSCRIPTION_DURING_IVR = os.getenv("START_TRANSCRIPTION_DURING_IVR", "true").lower() != "false"
TELNYX_DRY_RUN = os.getenv("TELNYX_DRY_RUN", "true").lower() != "false"
PORT = int(os.getenv("PORT", "8000"))

app = FastAPI(title="Outbound Hold-Aware AI Agent")
sessions: dict[str, dict[str, Any]] = {}

HOLD_PHRASES = (
    "please hold",
    "next available representative",
    "next available agent",
    "estimated wait time",
    "remain on the line",
    "your call is important",
    "one moment while i connect you",
)
REPRESENTATIVE_PHRASES = (
    "thanks for holding",
    "thank you for holding",
    "how can i help",
    "how may i help",
    "this is",
    "my name is",
    "who am i speaking with",
    "may i have",
)
DTMF_FREQUENCIES = {
    "1": (697, 1209),
    "2": (697, 1336),
    "3": (697, 1477),
    "4": (770, 1209),
    "5": (770, 1336),
    "6": (770, 1477),
    "7": (852, 1209),
    "8": (852, 1336),
    "9": (852, 1477),
    "0": (941, 1336),
    "*": (941, 1209),
    "#": (941, 1477),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode(value: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def required_missing() -> list[str]:
    if TELNYX_DRY_RUN:
        return []
    required = {
        "TELNYX_API_KEY": TELNYX_API_KEY,
        "TELNYX_CONNECTION_ID": TELNYX_CONNECTION_ID,
        "TELNYX_FROM_NUMBER": TELNYX_FROM_NUMBER,
        "TELNYX_IVR_ASSISTANT_ID": TELNYX_IVR_ASSISTANT_ID,
        "TELNYX_REPRESENTATIVE_ASSISTANT_ID": TELNYX_REPRESENTATIVE_ASSISTANT_ID,
        "PUBLIC_BASE_URL": PUBLIC_BASE_URL,
    }
    return [name for name, value in required.items() if not value]


async def telnyx_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if TELNYX_DRY_RUN:
        return {
            "data": {
                "id": f"dry-run-{uuid4()}",
                "call_control_id": payload.get("call_control_id", f"dry-run-call-{uuid4()}"),
                "state": "dry_run",
                "path": path,
                "request": payload,
            }
        }
    headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{API_BASE}{path}", headers=headers, json=payload)
    if response.is_error:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


def latest_session() -> Optional[dict[str, Any]]:
    active = [item for item in sessions.values() if item.get("state") not in {"call_ended", "failed"}]
    return active[-1] if active else None


def find_session(call_control_id: str) -> Optional[dict[str, Any]]:
    return next((item for item in sessions.values() if item.get("call_control_id") == call_control_id), None)


def assistant_context(session: dict[str, Any]) -> dict[str, Any]:
    hold_seconds = None
    if session.get("hold_started_at"):
        started = datetime.fromisoformat(session["hold_started_at"])
        hold_seconds = int((datetime.now(timezone.utc) - started).total_seconds())
    return {
        "session_id": session["session_id"],
        "objective": session.get("objective"),
        "target_company": session.get("target_company"),
        "call_state": session.get("state"),
        "time_on_hold_seconds": hold_seconds,
        "user_context": session.get("context", {}),
        "recent_transcript": session.get("transcript", [])[-5:],
    }


async def start_assistant(session: dict[str, Any], assistant_id: str, stage: str, greeting: str = "") -> None:
    response = await telnyx_post(
        f"/calls/{session['call_control_id']}/actions/ai_assistant_start",
        {
            "assistant": {"id": assistant_id},
            "greeting": greeting,
            "client_state": encode(assistant_context(session) | {"stage": stage}),
            "command_id": str(uuid4()),
        },
    )
    session["active_assistant"] = stage
    session.setdefault("events", []).append({"at": now(), "action": "ai_assistant_start", "stage": stage, "response": response})


async def stop_active_assistant(session: dict[str, Any], reason: str) -> None:
    if not session.get("active_assistant"):
        return
    response = await telnyx_post(
        f"/calls/{session['call_control_id']}/actions/ai_assistant_stop",
        {"client_state": encode(assistant_context(session) | {"reason": reason}), "command_id": str(uuid4())},
    )
    session.setdefault("events", []).append({"at": now(), "action": "ai_assistant_stop", "reason": reason, "response": response})
    session["active_assistant"] = None


async def start_transcription(session: dict[str, Any], stage: str) -> None:
    if session.get("transcription_active"):
        return
    response = await telnyx_post(
        f"/calls/{session['call_control_id']}/actions/transcription_start",
        {
            "transcription_engine": TRANSCRIPTION_ENGINE,
            "transcription_engine_config": {
                "transcription_model": TRANSCRIPTION_MODEL,
                "language": TRANSCRIPTION_LANGUAGE,
                "interim_results": True,
            },
            "transcription_tracks": "inbound",
            "client_state": encode(assistant_context(session) | {"stage": stage}),
            "command_id": str(uuid4()),
        },
    )
    session["transcription_active"] = True
    session.setdefault("events", []).append({"at": now(), "action": "transcription_start", "stage": stage, "response": response})


async def stop_transcription(session: dict[str, Any], stage: str) -> None:
    if not session.get("transcription_active"):
        return
    response = await telnyx_post(
        f"/calls/{session['call_control_id']}/actions/transcription_stop",
        {"client_state": encode(assistant_context(session) | {"stage": stage}), "command_id": str(uuid4())},
    )
    session["transcription_active"] = False
    session.setdefault("events", []).append({"at": now(), "action": "transcription_stop", "stage": stage, "response": response})


async def enter_hold(session: dict[str, Any], reason: str, confidence: float = 1.0) -> None:
    if session.get("state") == "hold_monitoring":
        return
    session["state"] = "hold_monitoring"
    session["hold_started_at"] = now()
    session.setdefault("events", []).append({"at": now(), "event": "hold_detected", "reason": reason, "confidence": confidence})
    await stop_active_assistant(session, reason)
    await start_transcription(session, "hold_monitoring")


async def representative_detected(session: dict[str, Any], reason: str) -> None:
    if session.get("state") == "live_conversation":
        return
    session["state"] = "representative_detected"
    session.setdefault("events", []).append({"at": now(), "event": "representative_detected", "reason": reason})
    greeting = f"hi, i am calling to {session.get('objective', 'complete the requested task')}."
    await start_assistant(session, TELNYX_REPRESENTATIVE_ASSISTANT_ID, "representative", greeting)
    session["state"] = "live_conversation"
    await stop_transcription(session, "live_conversation")


def extract_transcript(payload: dict[str, Any]) -> str:
    found: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"transcript", "text"} and isinstance(child, str):
                    found.append(child)
                else:
                    walk(child)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)
    return next((item.strip() for item in found if item.strip()), "")


def public_url(request: Request, path: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}{path}"
    return f"{str(request.base_url).rstrip('/')}{path}"


@app.get("/health")
async def health() -> dict[str, Any]:
    missing = required_missing()
    return {"ok": not missing, "dry_run": TELNYX_DRY_RUN, "missing": missing, "sessions": len(sessions)}


@app.post("/calls/outbound")
async def outbound_call(body: dict[str, Any]) -> dict[str, Any]:
    missing = required_missing()
    if missing:
        raise HTTPException(status_code=400, detail={"missing": missing})
    to_number = str(body.get("to", ""))
    if not to_number.startswith("+"):
        raise HTTPException(status_code=400, detail="to must be an E.164 phone number")
    session_id = str(uuid4())
    sessions[session_id] = {
        "session_id": session_id,
        "to": to_number,
        "from": TELNYX_FROM_NUMBER,
        "objective": body.get("objective", "reach a representative and complete the requested task"),
        "target_company": body.get("target_company", ""),
        "context": body.get("context", {}),
        "state": "dialing",
        "active_assistant": None,
        "transcription_active": False,
        "transcript": [],
        "events": [{"at": now(), "event": "outbound_call_requested"}],
    }
    response = await telnyx_post(
        "/calls",
        {
            "connection_id": TELNYX_CONNECTION_ID,
            "from": TELNYX_FROM_NUMBER,
            "to": to_number,
            "webhook_url": f"{PUBLIC_BASE_URL}/webhooks/telnyx",
            "webhook_url_method": "POST",
            "client_state": encode({"session_id": session_id, "stage": "dial"}),
            "command_id": str(uuid4()),
        },
    )
    data = response.get("data", {})
    sessions[session_id]["call_control_id"] = data.get("call_control_id")
    sessions[session_id]["call_leg_id"] = data.get("call_leg_id", "")
    sessions[session_id]["events"].append({"at": now(), "action": "dial", "response": data})
    return sessions[session_id]


@app.post("/webhooks/telnyx")
async def telnyx_webhook(
    request: Request,
    telnyx_timestamp: str = Header(default=""),
    telnyx_signature_ed25519: str = Header(default=""),
) -> dict[str, Any]:
    body = await request.body()
    if TELNYX_PUBLIC_KEY and not TELNYX_DRY_RUN:
        verify_signature_or_raise(body, telnyx_timestamp, telnyx_signature_ed25519)
    payload = json.loads(body.decode("utf-8"))
    data = payload.get("data", payload)
    event_type = str(data.get("event_type") or payload.get("event_type") or "")
    event_payload = data.get("payload", data)
    call_control_id = str(event_payload.get("call_control_id") or data.get("call_control_id") or "")
    session = find_session(call_control_id)
    if not session:
        return {"ok": True, "ignored": True, "reason": "unknown call_control_id", "event_type": event_type}

    transcript = extract_transcript(payload)
    if transcript:
        session.setdefault("transcript", []).append(transcript)
    session.setdefault("events", []).append({"at": now(), "event_type": event_type, "transcript": transcript})

    lowered = transcript.lower()
    if event_type == "call.answered":
        session["state"] = "ivr_navigation"
        await start_assistant(session, TELNYX_IVR_ASSISTANT_ID, "ivr")
        if START_TRANSCRIPTION_DURING_IVR:
            await start_transcription(session, "ivr_navigation")
    elif event_type == "call.hold" or any(phrase in lowered for phrase in HOLD_PHRASES):
        await enter_hold(session, event_type or "hold phrase", 1.0)
    elif event_type == "call.unhold" or (session.get("state") == "hold_monitoring" and any(phrase in lowered for phrase in REPRESENTATIVE_PHRASES)):
        await representative_detected(session, event_type or "representative phrase")
    elif event_type == "call.hangup":
        session["state"] = "call_ended"
        session["active_assistant"] = None
        session["transcription_active"] = False
    return {"ok": True, "event_type": event_type, "state": session["state"]}


@app.post("/tools/send-dtmf")
async def send_dtmf_tool(body: dict[str, Any]) -> dict[str, Any]:
    digits = str(body.get("digits", ""))
    if not digits or any(char not in DTMF_FREQUENCIES for char in digits):
        return tool_fallback("send_dtmf", "digits must contain only 0-9, *, or #")
    call_control_id = str(body.get("call_control_id") or (latest_session() or {}).get("call_control_id") or "")
    session = find_session(call_control_id)
    if not session:
        return tool_fallback("send_dtmf", "no active call_control_id")
    response = await telnyx_post(
        f"/calls/{call_control_id}/actions/send_dtmf",
        {
            "digits": digits,
            "duration_millis": 250,
            "client_state": encode(assistant_context(session) | {"tool": "send_dtmf", "reason": body.get("reason", "")}),
            "command_id": str(uuid4()),
        },
    )
    feedback_url = dtmf_feedback_url(digits)
    if feedback_url:
        await telnyx_post(
            f"/calls/{call_control_id}/actions/playback_start",
            {
                "audio_url": feedback_url,
                "audio_type": "wav",
                "target_legs": "both",
                "cache_audio": True,
                "client_state": encode(assistant_context(session) | {"tool": "dtmf_feedback"}),
                "command_id": str(uuid4()),
            },
        )
    session.setdefault("events", []).append({"at": now(), "tool": "send_dtmf", "digits": digits, "reason": body.get("reason", "")})
    return {"ok": True, "accepted": True, "tool": "send_dtmf", "telnyx_response": response}


@app.post("/tools/hold-detected")
async def hold_detected_tool(body: dict[str, Any]) -> dict[str, Any]:
    call_control_id = str(body.get("call_control_id") or (latest_session() or {}).get("call_control_id") or "")
    session = find_session(call_control_id)
    if not session:
        return tool_fallback("hold_detected", "no active call_control_id")
    await enter_hold(session, str(body.get("reason", "assistant hold-detected tool")), float(body.get("confidence", 1.0)))
    return {"ok": True, "accepted": True, "state": session["state"], "session": session}


@app.post("/tools/end-call")
async def end_call_tool(body: dict[str, Any]) -> dict[str, Any]:
    call_control_id = str(body.get("call_control_id") or (latest_session() or {}).get("call_control_id") or "")
    session = find_session(call_control_id)
    if not session:
        return tool_fallback("end_call", "no active call_control_id")
    response = await telnyx_post(
        f"/calls/{call_control_id}/actions/hangup",
        {"client_state": encode(assistant_context(session) | {"tool": "end_call", "reason": body.get("reason", "")}), "command_id": str(uuid4())},
    )
    session["state"] = "call_ended"
    session["active_assistant"] = None
    session["transcription_active"] = False
    return {"ok": True, "accepted": True, "tool": "end_call", "telnyx_response": response}


@app.get("/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    return list(sessions.values())


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="unknown session_id")
    return sessions[session_id]


@app.api_route("/fake-company/texml", methods=["GET", "POST"])
async def fake_company_texml(request: Request) -> Response:
    action_url = public_url(request, "/fake-company/menu")
    return texml(
        say("thank you for calling willow creek hotel."),
        f'<Gather action="{html.escape(action_url)}" input="dtmf" numDigits="1" timeout="8" validDigits="12">',
        say("for reservations, press 1. for the front desk, press 2."),
        "</Gather>",
        f"<Redirect>{html.escape(action_url)}</Redirect>",
    )


@app.api_route("/fake-company/menu", methods=["GET", "POST"])
async def fake_company_menu(request: Request) -> Response:
    values = await request_values(request)
    digit = (values.get("Digits") or values.get("digits") or [""])[0]
    if digit != "1":
        return texml(say("for reservations, please press 1."), f"<Redirect>{html.escape(public_url(request, '/fake-company/texml'))}</Redirect>")
    return texml(
        f"<Play>{html.escape(public_url(request, '/media/dtmf/1.wav'))}</Play>",
        say("reservations. one moment while i connect you."),
        say("please hold for the next available reservations agent."),
        say("your call is important to us."),
        '<Pause length="3"/>',
        say("thanks for holding, this is sarah with willow creek hotel reservations."),
        '<Pause length="5"/>',
        say("may i have the guest name for the reservation?"),
        '<Pause length="60"/>',
        say("thanks for calling willow creek hotel. goodbye."),
        "<Hangup/>",
    )


@app.get("/media/dtmf/{digit}.wav")
async def dtmf_wav(digit: str) -> Response:
    if digit not in DTMF_FREQUENCIES:
        raise HTTPException(status_code=404, detail="unknown digit")
    return Response(content=make_dtmf_wav(digit), media_type="audio/wav")


def dtmf_feedback_url(digits: str) -> str:
    if not PUBLIC_BASE_URL or not digits:
        return ""
    digit = digits[0]
    if digit not in DTMF_FREQUENCIES:
        return ""
    return f"{PUBLIC_BASE_URL}/media/dtmf/{quote(digit, safe='')}.wav"


def texml(*parts: str) -> Response:
    return Response(content="\n".join(['<?xml version="1.0" encoding="UTF-8"?>', "<Response>", *parts, "</Response>"]), media_type="application/xml")


def say(text: str) -> str:
    return f"<Say>{html.escape(text)}</Say>"


async def request_values(request: Request) -> dict[str, list[str]]:
    if request.method == "GET":
        return {key: [value] for key, value in request.query_params.items()}
    body = (await request.body()).decode()
    if not body:
        return {}
    if "application/json" in request.headers.get("content-type", ""):
        payload = json.loads(body)
        return {key: [str(value)] for key, value in payload.items()}
    return parse_qs(body)


def make_dtmf_wav(digit: str) -> bytes:
    sample_rate = 8000
    f1, f2 = DTMF_FREQUENCIES[digit]
    frames = bytearray()
    for n in range(int(sample_rate * 0.18)):
        sample = int(16000 * (math.sin(2 * math.pi * f1 * n / sample_rate) + math.sin(2 * math.pi * f2 * n / sample_rate)) / 2)
        frames += sample.to_bytes(2, "little", signed=True)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(frames))
    return output.getvalue()


def tool_fallback(tool: str, reason: str) -> dict[str, Any]:
    return {
        "ok": True,
        "accepted": False,
        "tool": tool,
        "reason": reason,
        "message": "tool request failed in the backend. do not say this out loud. stay silent and continue listening.",
    }


def verify_signature_or_raise(body: bytes, timestamp: str, signature: str) -> None:
    try:
        from nacl.encoding import Base64Encoder
        from nacl.signing import VerifyKey
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="install pynacl to verify Telnyx webhook signatures") from exc
    if not timestamp or not signature:
        raise HTTPException(status_code=401, detail="missing Telnyx webhook signature headers")
    try:
        VerifyKey(TELNYX_PUBLIC_KEY, encoder=Base64Encoder).verify(f"{timestamp}|".encode() + body, Base64Encoder.decode(signature))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="invalid Telnyx webhook signature") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
