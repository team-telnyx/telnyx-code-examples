#!/usr/bin/env python3
"""AI Subscription Cancel-Save Retention Agent.

Inbound voice agent that handles subscription cancellation requests. It
verifies the customer by caller ID, asks why they want to cancel, classifies
the reason with Telnyx AI Inference, offers one eligible save option, and
records the outcome.

The agent is non-manipulative. A direct "cancel now" or refusal of an offer
ends with a graceful cancellation. Pause is offered for temporary
situations. Transfer to a human is always available.

State is in-memory (dict/list) — fine for a single-process demo.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
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
HUMAN_ESCALATION_NUMBER = os.getenv("HUMAN_ESCALATION_NUMBER", "")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

CANCEL_REASONS = (
    "too_expensive",
    "not_using",
    "missing_feature",
    "support_issue",
    "competitor_switch",
    "temporary_pause",
    "other",
)

OFFER_POLICY = {
    "too_expensive": {
        "offer": "25% off for 3 months",
        "outcome_if_accepted": "saved",
    },
    "not_using": {
        "offer": "a free onboarding call plus one free month",
        "outcome_if_accepted": "saved",
    },
    "missing_feature": {
        "offer": "I will flag your feedback to our product team and have a specialist follow up within two business days",
        "outcome_if_accepted": "needs_followup",
    },
    "support_issue": {
        "offer": "priority support callback from a senior agent within one business day",
        "outcome_if_accepted": "needs_followup",
    },
    "competitor_switch": {
        "offer": "a 15-minute comparison consultation with a specialist who can walk through how we differ",
        "outcome_if_accepted": "needs_followup",
    },
    "temporary_pause": {
        "offer": "pause your subscription for up to 60 days, no charge",
        "outcome_if_accepted": "paused",
    },
    "other": {
        "offer": "a follow-up call from a specialist to understand what would have made this work for you",
        "outcome_if_accepted": "needs_followup",
    },
}

URGENT_PHRASES = ("lawyer", "sue", "scam", "fraud", "report you", "bbb", "chargeback")

customers: dict[str, dict[str, Any]] = {}
retention_cases: dict[str, dict[str, Any]] = {}
calls: dict[str, dict[str, Any]] = {}
processed_events: dict[str, float] = {}
EVENT_TTL = 3600


def _ttl_cleanup_loop() -> None:
    while True:
        time.sleep(300)
        cutoff = time.time() - EVENT_TTL
        expired_events = [k for k, v in processed_events.items() if v < cutoff]
        for k in expired_events:
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
    return _post(f"{API}/messages", {"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10) is not None


def lookup_customer(phone: str) -> dict[str, Any] | None:
    if not phone:
        return None
    for c in customers.values():
        if c.get("phone") == phone:
            return c
    return None


def classify_reason(text: str, transcript: list[dict[str, str]] | None = None) -> dict[str, Any]:
    fallback = {
        "reason": "other",
        "sentiment": "neutral",
        "wants_human": False,
        "wants_pause": False,
        "summary": text[:160],
    }
    context = ""
    if transcript:
        last_user = next(
            (m["content"] for m in reversed(transcript) if m.get("role") == "user"),
            text,
        )
        context = last_user
    else:
        context = text

    lowered = context.lower()
    if any(phrase in lowered for phrase in URGENT_PHRASES):
        return {
            "reason": "other",
            "sentiment": "angry",
            "wants_human": True,
            "wants_pause": False,
            "summary": context[:160],
        }
    if any(w in lowered for w in ("human", "agent", "person", "representative", "supervisor", "manager")):
        fallback["wants_human"] = True
    if any(w in lowered for w in ("pause", "few months", "couple months", "hold off", "just for now", "temporary")):
        fallback["reason"] = "temporary_pause"
        fallback["wants_pause"] = True

    try:
        messages = [
            {
                "role": "system",
                "content": (
                    "You classify why a customer wants to cancel their subscription. "
                    "Return ONLY JSON with keys: "
                    "reason (too_expensive|not_using|missing_feature|support_issue|competitor_switch|temporary_pause|other), "
                    "sentiment (calm|frustrated|angry|sad|neutral), "
                    "wants_human (boolean), "
                    "wants_pause (boolean), "
                    "summary (one short line, <= 120 chars)."
                ),
            },
            {"role": "user", "content": context},
        ]
        resp = requests.post(
            INFERENCE_URL,
            headers=HEADERS,
            json={"model": AI_MODEL, "messages": messages, "max_tokens": 200, "temperature": 0.1},
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)
        reason = parsed.get("reason", fallback["reason"])
        if reason not in CANCEL_REASONS:
            reason = "other"
        return {
            "reason": reason,
            "sentiment": parsed.get("sentiment", fallback["sentiment"]),
            "wants_human": bool(parsed.get("wants_human", fallback.get("wants_human", False))),
            "wants_pause": bool(parsed.get("wants_pause", fallback.get("wants_pause", False))),
            "summary": (parsed.get("summary") or fallback["summary"])[:160],
        }
    except Exception:
        return fallback


def detect_direct_cancel(text: str) -> bool:
    lowered = text.lower().strip()
    direct_phrases = (
        "cancel now", "cancel it", "cancel please", "cancel my subscription",
        "cancel my account", "cancel my plan", "cancel my service",
        "please cancel", "just cancel", "i want to cancel",
        "i wanna cancel", "i want out", "stop the subscription",
        "stop my subscription", "end it", "end my subscription",
        "no thanks", "no thank you", "no deal",
        "i'll think about it", "i will think about it",
    )
    return any(p in lowered for p in direct_phrases)


def detect_yes(text: str) -> bool:
    lowered = text.lower().strip()
    return bool(re.search(r"\b(yes|yeah|yep|sure|ok|okay|sounds good|i'll take it|deal|i do|please do|sign me up)\b", lowered))


def detect_no(text: str) -> bool:
    lowered = text.lower().strip()
    return bool(re.search(r"\b(no|nah|nope|not interested|no thanks|no thank you|decline|pass|skip)\b", lowered))


def start_case(phone: str) -> tuple[dict[str, Any] | None, str | None]:
    customer = lookup_customer(phone)
    if not customer:
        return None, "I don't see your account on this number. Could you confirm the phone number on file?"
    if customer.get("status") == "cancelled":
        return None, f"Your account is already cancelled as of {customer.get('cancelled_at', 'earlier today')}. Is there anything else I can help with?"

    case_id = f"ret-{uuid.uuid4().hex[:8]}"
    case = {
        "case_id": case_id,
        "customer_id": customer["customer_id"],
        "phone": phone,
        "name": customer.get("name", "there"),
        "plan": customer.get("plan"),
        "status": "open",
        "outcome": None,
        "reason": None,
        "offer": None,
        "summary": None,
        "transcript": [],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    retention_cases[case_id] = case
    return case, None


def finalize_case(case_id: str, outcome: str, **fields: Any) -> dict[str, Any]:
    case = retention_cases.get(case_id)
    if not case:
        return {"error": "case not found"}
    case["outcome"] = outcome
    case["status"] = "complete"
    case["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    for k, v in fields.items():
        case[k] = v
    customer = customers.get(case["customer_id"])
    if customer:
        if outcome == "cancelled":
            customer["status"] = "cancelled"
            customer["cancelled_at"] = case["completed_at"]
        elif outcome == "saved":
            customer["status"] = "active"
        elif outcome == "paused":
            customer["status"] = "paused"
            customer["paused_until"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 60 * 86400))
    return case


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
    calls.setdefault(
        ccid,
        {"caller": caller, "case_id": None, "step": "greeting", "transcript": [], "last_seen": time.time()},
    )
    calls[ccid]["last_seen"] = time.time()
    call = calls[ccid]

    if event == "call.initiated" and p.get("direction") == "incoming":
        _post(f"{API}/calls/{ccid}/actions/answer", {})
    elif event == "call.answered":
        case, err = start_case(caller)
        if err:
            call["step"] = "error"
            _post(
                f"{API}/calls/{ccid}/actions/speak",
                {"payload": err, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
            )
        else:
            call["case_id"] = case["case_id"]
            call["step"] = "awaiting_reason"
            greeting = f"Hi {case['name']}, this is the customer success team. I understand you're calling about your subscription. Could you tell me what's prompting the change?"
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
        case_id = call.get("case_id")
        case = retention_cases.get(case_id) if case_id else None
        if not case:
            return jsonify({"status": "no_case"}), 200

        case["transcript"].append({"role": "user", "content": speech})

        if call["step"] == "awaiting_reason":
            if detect_direct_cancel(speech):
                finalize_case(case_id, "cancelled", reason="direct_cancel_request", summary="Customer requested cancellation directly.")
                call["step"] = "done"
                _post(
                    f"{API}/calls/{ccid}/actions/speak",
                    {
                        "payload": "Understood. I've cancelled your subscription. You'll get a confirmation email shortly. Take care.",
                        "voice": TTS_VOICE,
                        "language_code": TTS_LANGUAGE,
                    },
                )
                return jsonify({"status": "cancelled_direct"}), 200

            classification = classify_reason(speech, case["transcript"])
            case["reason"] = classification["reason"]
            case["summary"] = classification["summary"]
            call["step"] = "awaiting_offer_response"

            if classification["wants_human"] or classification["sentiment"] == "angry":
                call["step"] = "transferring"
                finalize_case(
                    case_id,
                    "transferred",
                    reason=classification["reason"],
                    summary=classification["summary"],
                )
                _post(
                    f"{API}/calls/{ccid}/actions/speak",
                    {
                        "payload": "Of course, let me transfer you to a specialist right away.",
                        "voice": TTS_VOICE,
                        "language_code": TTS_LANGUAGE,
                    },
                )
                if HUMAN_ESCALATION_NUMBER:
                    _post(
                        f"{API}/calls/{ccid}/actions/transfer",
                        {"to": HUMAN_ESCALATION_NUMBER, "from": MAIN_NUMBER},
                    )
                return jsonify({"status": "transferring"}), 200

            policy = OFFER_POLICY.get(classification["reason"], OFFER_POLICY["other"])
            case["offer"] = policy["offer"]
            case["offer_outcome_if_accepted"] = policy["outcome_if_accepted"]
            offer_text = (
                f"Thanks for letting me know. Based on what you said, here's one thing I can offer: "
                f"{policy['offer']}. Would that change your mind, or would you still like to cancel?"
            )
            _post(
                f"{API}/calls/{ccid}/actions/speak",
                {"payload": offer_text, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
            )
        elif call["step"] == "awaiting_offer_response":
            if detect_yes(speech):
                policy = OFFER_POLICY.get(case["reason"], OFFER_POLICY["other"])
                finalize_case(
                    case_id,
                    policy["outcome_if_accepted"],
                    accepted_offer=True,
                )
                call["step"] = "done"
                thanks = {
                    "saved": "Great. I've applied that to your account now. You'll see it on your next statement.",
                    "paused": "Done. Your subscription is paused for 60 days. We'll remind you before it resumes.",
                    "needs_followup": "Got it. A specialist will reach out within two business days. Thanks for giving us the chance.",
                }.get(policy["outcome_if_accepted"], "Thanks. We'll be in touch shortly.")
                _post(
                    f"{API}/calls/{ccid}/actions/speak",
                    {"payload": thanks, "voice": TTS_VOICE, "language_code": TTS_LANGUAGE},
                )
                return jsonify({"status": "accepted_offer"}), 200
            if detect_no(speech) or detect_direct_cancel(speech):
                finalize_case(case_id, "cancelled", accepted_offer=False)
                call["step"] = "done"
                _post(
                    f"{API}/calls/{ccid}/actions/speak",
                    {
                        "payload": "Understood. I've cancelled your subscription. You'll get a confirmation email shortly.",
                        "voice": TTS_VOICE,
                        "language_code": TTS_LANGUAGE,
                    },
                )
                return jsonify({"status": "cancelled_after_offer"}), 200
            _post(
                f"{API}/calls/{ccid}/actions/speak",
                {
                    "payload": "Just to confirm, would you like to take me up on the offer, or proceed with cancellation?",
                    "voice": TTS_VOICE,
                    "language_code": TTS_LANGUAGE,
                },
            )
    elif event == "call.hangup":
        case_id = call.get("case_id")
        if call.get("step") not in ("done", "transferring", "error") and case_id:
            case = retention_cases.get(case_id)
            if case and case["status"] == "open":
                finalize_case(case_id, "needs_followup", reason=case.get("reason"), summary="Customer hung up before resolution.")
        calls.pop(ccid, None)
    return jsonify({"status": "ok"}), 200


@app.route("/customers", methods=["POST"])
def create_customer():
    body = request.get_json(silent=True) or {}
    customer_id = body.get("customer_id") or f"CUST-{uuid.uuid4().hex[:8]}"
    if customer_id in customers:
        return jsonify({"error": "customer exists"}), 409
    if not body.get("phone"):
        return jsonify({"error": "phone is required"}), 400
    customer = {
        "customer_id": customer_id,
        "name": body.get("name", "Customer"),
        "phone": body["phone"],
        "plan": body.get("plan", "standard"),
        "status": "active",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    customers[customer_id] = customer
    return jsonify({"customer": customer}), 201


@app.route("/customers", methods=["GET"])
def list_customers():
    return jsonify({"customers": list(customers.values()), "total": len(customers)}), 200


@app.route("/retention-cases", methods=["GET"])
def list_cases():
    status = request.args.get("status")
    outcome = request.args.get("outcome")
    items = list(retention_cases.values())
    if status:
        items = [c for c in items if c["status"] == status]
    if outcome:
        items = [c for c in items if c["outcome"] == outcome]
    items.sort(key=lambda c: c["created_at"], reverse=True)
    return jsonify({"cases": items, "total": len(items)}), 200


@app.route("/retention-cases/<case_id>", methods=["GET"])
def get_case(case_id: str):
    case = retention_cases.get(case_id)
    if not case:
        return jsonify({"error": "not found"}), 404
    return jsonify(case), 200


@app.route("/retention-cases/<case_id>/complete", methods=["POST"])
def complete_case(case_id: str):
    body = request.get_json(silent=True) or {}
    outcome = body.get("outcome", "needs_followup")
    if outcome not in ("saved", "cancelled", "paused", "transferred", "needs_followup"):
        return jsonify({"error": "invalid outcome"}), 400
    case = finalize_case(
        case_id,
        outcome,
        accepted_offer=body.get("accepted_offer", False),
        notes=body.get("notes"),
    )
    if "error" in case:
        return jsonify(case), 404
    return jsonify(case), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "active_calls": len(calls),
            "open_cases": sum(1 for c in retention_cases.values() if c["status"] == "open"),
            "customers": len(customers),
        }
    ), 200


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT)
