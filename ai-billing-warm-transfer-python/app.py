#!/usr/bin/env python3
"""Inbound billing-dispute warm transfer using Telnyx Call Control."""

import os

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

BILLING_VOICE = os.getenv(
    "BILLING_VOICE", "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02"
)
SPECIALIST_VOICE = os.getenv(
    "SPECIALIST_VOICE", "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f"
)

active_calls = {}
transfer_sessions = {}


def speak(call_control_id: str, text: str, voice: str) -> None:
    client.calls.actions.speak(
        call_control_id=call_control_id,
        payload=text,
        voice=voice,
        language="en-US",
    )


def gather_billing_issue(call_control_id: str) -> None:
    client.calls.actions.gather_using_ai(
        call_control_id=call_control_id,
        parameters={
            "type": "object",
            "properties": {
                "billing_issue": {
                    "type": "string",
                    "description": "the caller's billing question or problem",
                }
            },
            "required": ["billing_issue"],
        },
        assistant={
            "instructions": "listen carefully to the caller's billing question and return it in billing_issue without adding advice",
            "model": os.getenv("TELNYX_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
        },
        user_response_timeout_ms=10000,
    )


def gather_transfer_consent(call_control_id: str) -> None:
    client.calls.actions.gather_using_ai(
        call_control_id=call_control_id,
        parameters={
            "type": "object",
            "properties": {
                "route_to_specialist": {
                    "type": "string",
                    "enum": ["yes", "no"],
                    "description": "whether the caller wants to speak with a billing specialist",
                }
            },
            "required": ["route_to_specialist"],
        },
        assistant={
            "instructions": "listen for whether the caller wants a billing specialist and return only yes or no in route_to_specialist",
            "model": os.getenv("TELNYX_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
        },
        user_response_timeout_ms=10000,
    )


def gather_result(data: dict) -> dict:
    event = data.get("data", {}) or {}
    payload = event.get("payload", event) if isinstance(event, dict) else {}
    result = payload.get("result", {}) if isinstance(payload, dict) else {}
    return result if isinstance(result, dict) else {}


def dial_specialist(original_call_id: str) -> dict:
    specialist_number = os.getenv("HUMAN_TRANSFER_NUMBER")
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    connection_id = os.getenv("TELNYX_CONNECTION_ID")
    if not all((specialist_number, from_number, connection_id)):
        raise ValueError(
            "TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID, and HUMAN_TRANSFER_NUMBER are required"
        )

    response = client.calls.dial(
        from_=from_number,
        to=specialist_number,
        connection_id=connection_id,
    )
    specialist_call_id = response.data.call_control_id
    transfer_sessions[specialist_call_id] = {
        "original_call_id": original_call_id,
        "status": "connecting",
    }
    return specialist_call_id


def bridge_calls(original_call_id: str, specialist_call_id: str) -> None:
    client.calls.actions.transfer(
        call_control_id=original_call_id,
        to=specialist_call_id,
    )
    transfer_sessions[specialist_call_id]["status"] = "completed"


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.post("/webhooks/voice")
def voice_webhook():
    data = request.get_json(silent=True) or {}
    event = data.get("data") or {}
    if not event:
        return jsonify({"error": "invalid webhook payload"}), 400

    payload = event.get("payload", event)
    event_type = event.get("event_type")
    call_control_id = payload.get("call_control_id")
    if not call_control_id:
        return jsonify({"error": "missing call control id"}), 400

    try:
        if event_type == "call.initiated":
            if str(payload.get("direction", "")).lower() in {"incoming", "inbound"}:
                active_calls[call_control_id] = {"status": "answering"}
                client.calls.actions.answer(call_control_id=call_control_id)
            return jsonify({"status": "received"})

        if event_type == "call.answered":
            if call_control_id in transfer_sessions:
                transfer_sessions[call_control_id]["status"] = "answered"
                speak(
                    call_control_id,
                    "hi, this is the cedar harbor bank billing specialist. i am reviewing the billing issue now and connecting you with the specialist line.",
                    SPECIALIST_VOICE,
                )
                transfer_sessions[call_control_id]["status"] = "target_intro"
            elif call_control_id in active_calls:
                active_calls[call_control_id]["status"] = "billing_greeting"
                speak(
                    call_control_id,
                    "hi, this is cedar harbor bank billing support. how can i help you today?",
                    BILLING_VOICE,
                )
            return jsonify({"status": "received"})

        if event_type == "call.speak.ended":
            if call_control_id in transfer_sessions:
                session = transfer_sessions[call_control_id]
                if session.get("status") == "target_intro":
                    bridge_calls(session["original_call_id"], call_control_id)
                    return jsonify({"status": "transfer_completed"})

            if call_control_id in active_calls:
                status = active_calls[call_control_id].get("status")
                if status == "billing_greeting":
                    gather_billing_issue(call_control_id)
                    active_calls[call_control_id]["status"] = "collecting_billing_issue"
                elif status == "specialist_offer":
                    gather_transfer_consent(call_control_id)
                    active_calls[call_control_id]["status"] = "collecting_transfer_consent"
            return jsonify({"status": "received"})

        if event_type == "call.ai_gather.ended" and call_control_id in active_calls:
            result = gather_result(data)
            status = active_calls[call_control_id].get("status")
            if status == "collecting_billing_issue":
                active_calls[call_control_id]["billing_issue"] = result.get("billing_issue", "")
                active_calls[call_control_id]["status"] = "specialist_offer"
                speak(
                    call_control_id,
                    "thanks for explaining that. if you would like to open a dispute for that invoice, i can transfer you to a billing specialist who can take a closer look. would you like me to connect you?",
                    BILLING_VOICE,
                )
                return jsonify({"status": "specialist_offer"})

            choice = str(result.get("route_to_specialist", "")).strip().lower()
            if status == "collecting_transfer_consent" and choice == "yes":
                specialist_call_id = dial_specialist(call_control_id)
                active_calls[call_control_id]["status"] = "connecting_specialist"
                return jsonify({"status": "specialist_requested", "specialist_call_id": specialist_call_id})
            if status == "collecting_transfer_consent" and choice == "no":
                active_calls[call_control_id]["status"] = "continuing_without_specialist"
                speak(call_control_id, "okay, i can keep helping you here.", BILLING_VOICE)
                return jsonify({"status": "specialist_declined"})

            active_calls[call_control_id]["status"] = "specialist_offer"
            speak(call_control_id, "please say yes if you want a billing specialist, or no if you want to continue here.", BILLING_VOICE)
            return jsonify({"status": "choice_unclear"})

        if event_type == "call.hangup":
            active_calls.pop(call_control_id, None)
            transfer_sessions.pop(call_control_id, None)

        return jsonify({"status": "received"})
    except (telnyx.APIStatusError, ValueError) as error:
        return jsonify({"error": str(error)}), 502


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        port=int(os.getenv("PORT", "5000")),
    )
