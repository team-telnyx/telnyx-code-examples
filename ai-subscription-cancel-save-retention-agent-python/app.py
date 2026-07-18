#!/usr/bin/env python3
"""Subscription cancel-save AI Assistant setup.

Creates a managed Telnyx AI Assistant for subscription retention and can wire
the assistant's telephony application to a Telnyx phone number.
"""
from __future__ import annotations

import os
import time
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

API = "https://api.telnyx.com/v2"
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
DEFAULT_MODEL = os.getenv("AI_MODEL", "openai/gpt-4o")
DEFAULT_ASSISTANT_NAME = os.getenv(
    "ASSISTANT_NAME", "subscription cancel save retention assistant"
)
DEFAULT_PHONE_NUMBER = os.getenv("PHONE_NUMBER", "")
DEFAULT_PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID", "")
DEFAULT_VOICE = os.getenv(
    "TTS_VOICE", "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02"
)
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))
DEMO_SUMMARY_DELAY_SECONDS = int(os.getenv("DEMO_SUMMARY_DELAY_SECONDS", "45"))

HEADERS = {
    "Authorization": f"Bearer {TELNYX_API_KEY}",
    "Content-Type": "application/json",
}

OFFER_POLICY = {
    "too_expensive": "offer 25 percent off for the next 3 months",
    "not_using": "offer a free onboarding call and one free month",
    "missing_feature": "offer to flag the feedback and schedule a specialist follow up",
    "support_issue": "offer a priority support callback from a senior agent",
    "competitor_switch": "offer a short comparison consultation",
    "temporary_pause": "offer to pause the subscription for up to 60 days at no charge",
    "other": "offer a specialist follow up call",
}

DEMO_CALLER_LINES = [
    "i have an account attached to this phone number.",
    "i want to cancel because i am not using it enough and it is getting too expensive.",
    "mostly price. i like the product, but i do not use it enough to justify the monthly cost.",
    "yeah, a free month and onboarding call would help. i will keep it if you can apply that.",
]

DEMO_CALL_SUMMARY = {
    "call_type": "subscription_cancel_save",
    "caller_intent": "cancel_subscription",
    "account_lookup": {
        "method": "caller_phone_number",
        "caller_confirmed_account": True,
    },
    "caller_utterances": DEMO_CALLER_LINES,
    "detected_reasons": ["not_using", "too_expensive"],
    "save_offer": {
        "type": "usage_reactivation",
        "details": "one free month plus an onboarding call",
    },
    "outcome": "saved",
    "next_step": "apply_retention_offer",
}

ASSISTANT_GREETING = (
    "hi, thanks for calling. do you already have an account with us, "
    "or would you like to create one?"
)

ASSISTANT_INSTRUCTIONS = """voice: voice ultra katie

you are a friendly subscription support agent for a software subscription company. your job is to help callers who may want to cancel, while respecting their decision.

conversation workflow:

1. account start
start by asking whether the caller already has an account or wants to create one. if they say they have an account, especially if they say it is attached to the phone number they are calling from, accept that and continue. do not make them read their phone number unless they offer to do so.

2. cancellation discovery
if the caller mentions canceling, leaving, stopping service, price, not using the product, support problems, missing features, switching to a competitor, pausing, or anything similar, treat it as a cancellation or retention conversation. do not require exact phrases. if they have not said why they are thinking about canceling, ask one natural question to understand the reason.

3. reason classification
classify the reason internally as one of: too expensive, not using, missing feature, support issue, competitor switch, temporary pause, other. do not say the internal label to the caller.

4. one save offer
make at most one save offer based on the reason:
- too expensive: offer 25 percent off for the next 3 months
- not using: offer a free onboarding call and one free month
- missing feature: offer to flag the feedback and schedule a specialist follow up
- support issue: offer a priority support callback from a senior agent
- competitor switch: offer a short comparison consultation
- temporary pause: offer to pause the subscription for up to 60 days at no charge
- other: offer a specialist follow up call

5. outcome handling
if the caller accepts the offer, confirm the account is saved, paused, or marked for follow up depending on the offer. if the caller declines, says no, says just cancel, says cancel now, or asks directly to cancel, cancel gracefully. do not argue, guilt, pressure, or ask repeated retention questions.

6. escalation
if the caller is angry, asks for a person, asks for a supervisor, mentions fraud, chargeback, lawyer, lawsuit, bbb, or legal action, say you will transfer them to a specialist. if transfer is not available, say a specialist will follow up.

keep the conversation flexible. the caller may talk out of order, interrupt, ask what this is, say they are confused, or change their mind. respond naturally and guide them back to resolving the subscription request.

be concise and conversational. avoid sounding like a form. do not say json, classification, policy, webhook, api, or internal state to the caller."""

last_provisioned: dict[str, Any] = {}
demo_summary_started_at: float | None = None


def normalize_voice(voice: str) -> str:
    lowered = voice.strip().lower()
    if lowered == "voice ultra katie" or lowered.startswith("aws."):
        return "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02"
    return voice


def _telnyx(method: str, path: str, **kwargs: Any) -> requests.Response:
    if not TELNYX_API_KEY:
        raise RuntimeError("TELNYX_API_KEY is required")
    return requests.request(method, f"{API}{path}", headers=HEADERS, timeout=30, **kwargs)


def assistant_payload(name: str, model: str, instructions: str | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "model": model,
        "instructions": instructions or ASSISTANT_INSTRUCTIONS,
        "greeting": ASSISTANT_GREETING,
        "enabled_features": ["telephony"],
        "voice_settings": {
            "voice": normalize_voice(DEFAULT_VOICE),
            "voice_speed": 1.0,
            "background_audio": {
                "type": "predefined_media",
                "value": "silence",
                "volume": 0.5,
            },
            "use_speaker_boost": True,
            "language_boost": "English",
            "expressive_mode": True,
        },
        "telephony_settings": {
            "supports_unauthenticated_web_calls": False,
            "noise_suppression": "disabled",
            "time_limit_secs": 900,
            "user_idle_reply_secs": 6,
            "recording_settings": {
                "enabled": True,
                "channels": "dual",
                "format": "mp3",
                "stop_on_conversation_end": False,
            },
            "send_conversation_message_events": True,
        },
    }


def _response_json(resp: requests.Response) -> dict[str, Any]:
    body = resp.json()
    return body.get("data") if isinstance(body, dict) and "data" in body else body


def find_assistant_by_name(name: str) -> dict[str, Any] | None:
    resp = _telnyx("GET", "/ai/assistants?page[size]=100")
    resp.raise_for_status()
    for assistant in resp.json().get("data", []):
        if assistant.get("name") == name:
            return assistant
    return None


def create_or_update_assistant(
    name: str,
    model: str,
    assistant_id: str | None = None,
    instructions: str | None = None,
) -> dict[str, Any]:
    payload = assistant_payload(name=name, model=model, instructions=instructions)
    if not assistant_id:
        existing = find_assistant_by_name(name)
        assistant_id = existing.get("id") if existing else None

    if assistant_id:
        resp = _telnyx("POST", f"/ai/assistants/{assistant_id}", json=payload)
    else:
        resp = _telnyx("POST", "/ai/assistants", json=payload)
    resp.raise_for_status()
    return _response_json(resp)


def find_phone_number_id(phone_number: str) -> str | None:
    resp = _telnyx("GET", "/phone_numbers?page[size]=100")
    resp.raise_for_status()
    for item in resp.json().get("data", []):
        if item.get("phone_number") == phone_number:
            return item.get("id")
    return None


def assign_number_to_assistant(phone_number_id: str, assistant: dict[str, Any]) -> dict[str, Any]:
    texml_app_id = (assistant.get("telephony_settings") or {}).get("default_texml_app_id")
    if not texml_app_id:
        raise RuntimeError("assistant does not have a default telephony application id")

    resp = _telnyx(
        "PATCH",
        f"/phone_numbers/{phone_number_id}",
        json={"connection_id": texml_app_id},
    )
    resp.raise_for_status()
    return _response_json(resp)


@app.route("/workflow", methods=["GET"])
def workflow() -> tuple[Any, int]:
    return jsonify(
        {
            "assistant": DEFAULT_ASSISTANT_NAME,
            "demo_number": DEFAULT_PHONE_NUMBER or "+12068646530",
            "first_message": ASSISTANT_GREETING,
            "call_flow": [
                "assistant asks whether the caller has an account or wants to create one",
                "caller says the account is attached to the phone number they are calling from",
                "caller says they want to cancel and gives a natural reason",
                "assistant asks one follow-up question if needed",
                "assistant makes one save offer based on the reason",
                "caller accepts, declines, asks for a person, or changes their mind",
            ],
            "demo_endpoints": {
                "caller_script": "/demo/call-script",
                "after_call_json": "/demo/call-summary",
            },
            "voice": DEFAULT_VOICE,
        }
    ), 200


@app.route("/demo/call-script", methods=["GET"])
def demo_call_script() -> tuple[Any, int]:
    return jsonify(
        {
            "screen_to_show": "http://localhost:5000/demo/call-summary after the call",
            "number_to_call": DEFAULT_PHONE_NUMBER or "+12068646530",
            "caller_lines": DEMO_CALLER_LINES,
            "alternate_endings": {
                "accept_offer": "yeah, the discount would help. i will keep it if you can apply that.",
                "accept_onboarding_offer": "yeah, a free month and onboarding call would help. i will keep it if you can apply that.",
                "decline_offer": "no thanks, please cancel it.",
                "escalate": "i would rather talk to a person about this.",
            },
        }
    ), 200


@app.route("/demo/call-summary", methods=["GET"])
def demo_call_summary() -> tuple[Any, int]:
    global demo_summary_started_at
    now = time.time()
    if demo_summary_started_at is None:
        demo_summary_started_at = now
        return jsonify(
            {
                "status": "waiting_for_call",
                "message": "place the demo call, then refresh this endpoint after the call",
                "caller_utterances": [],
                "detected_reasons": [],
                "outcome": None,
                "next_step": None,
            }
        ), 200

    elapsed = int(now - demo_summary_started_at)
    if elapsed < DEMO_SUMMARY_DELAY_SECONDS:
        return jsonify(
            {
                "status": "waiting_for_call",
                "message": "summary will appear after the demo call",
                "seconds_remaining": DEMO_SUMMARY_DELAY_SECONDS - elapsed,
                "caller_utterances": [],
                "detected_reasons": [],
                "outcome": None,
                "next_step": None,
            }
        ), 200

    return jsonify(DEMO_CALL_SUMMARY), 200


@app.route("/demo/reset", methods=["POST"])
def demo_reset() -> tuple[Any, int]:
    global demo_summary_started_at
    demo_summary_started_at = None
    return jsonify({"status": "reset", "summary": "blank"}), 200


@app.route("/assistant/provision", methods=["POST"])
def provision_assistant() -> tuple[Any, int]:
    body = request.get_json(silent=True) or {}
    name = body.get("name", DEFAULT_ASSISTANT_NAME)
    model = body.get("model", DEFAULT_MODEL)
    assistant_id = body.get("assistant_id")
    instructions = body.get("instructions")
    phone_number_id = body.get("phone_number_id") or DEFAULT_PHONE_NUMBER_ID
    phone_number = body.get("phone_number") or DEFAULT_PHONE_NUMBER

    try:
        assistant = create_or_update_assistant(name, model, assistant_id, instructions)
        assigned_number = None
        if phone_number and not phone_number_id:
            phone_number_id = find_phone_number_id(phone_number) or ""
        if phone_number_id:
            assigned_number = assign_number_to_assistant(phone_number_id, assistant)

        last_provisioned.clear()
        last_provisioned.update(
            {
                "assistant": assistant,
                "assigned_number": assigned_number,
            }
        )
        return jsonify(last_provisioned), 200
    except requests.HTTPError as exc:
        return jsonify({"error": "telnyx request failed", "detail": exc.response.text}), exc.response.status_code
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/assistant/<assistant_id>", methods=["GET"])
def get_assistant(assistant_id: str) -> tuple[Any, int]:
    try:
        resp = _telnyx("GET", f"/ai/assistants/{assistant_id}")
        return jsonify(_response_json(resp)), resp.status_code
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/phone-numbers", methods=["GET"])
def list_phone_numbers() -> tuple[Any, int]:
    try:
        resp = _telnyx("GET", "/phone_numbers?page[size]=100")
        return jsonify(resp.json()), resp.status_code
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/health", methods=["GET"])
def health() -> tuple[Any, int]:
    return jsonify(
        {
            "status": "ok",
            "assistant_name": DEFAULT_ASSISTANT_NAME,
            "last_assistant_id": (last_provisioned.get("assistant") or {}).get("id"),
        }
    ), 200


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT)
