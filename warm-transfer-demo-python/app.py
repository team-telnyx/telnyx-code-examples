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
    "SPECIALIST_VOICE", "Telnyx.Ultra.0d42f0f6-c019-4082-b250-1c16133d1c82"
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
            "instructions": "return yes when the caller agrees, accepts, says sure, says yes please, says connect me, or otherwise requests the billing specialist. return no only when the caller explicitly declines or says they want to continue without a specialist",
            "model": os.getenv("TELNYX_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
        },
        user_response_timeout_ms=10000,
    )


def gather_specialist_name(call_control_id: str, billing_issue: str) -> None:
    client.calls.actions.gather_using_ai(
        call_control_id=call_control_id,
        parameters={
            "type": "object",
            "properties": {
                "customer_name": {
                    "type": "string",
                    "description": "the caller's full name",
                }
            },
            "required": ["customer_name"],
        },
        assistant={
            "instructions": "act as a billing dispute specialist. collect the caller's full name and return it in customer_name without adding advice",
            "model": os.getenv("TELNYX_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
        },
        message_history=[
            {
                "role": "assistant",
                "content": "the caller reported this billing issue: " + billing_issue,
            }
        ],
        user_response_timeout_ms=10000,
    )


def gather_specialist_phone_confirmation(call_control_id: str) -> None:
    client.calls.actions.gather_using_ai(
        call_control_id=call_control_id,
        parameters={
            "type": "object",
            "properties": {
                "phone_confirmation": {
                    "type": "string",
                    "description": "whether the caller agrees to use the phone number they are calling from for updates, or provides a different number",
                }
            },
            "required": ["phone_confirmation"],
        },
        assistant={
            "instructions": "ask whether the caller wants to use the number they are calling from for updates. return the caller's answer in phone_confirmation without adding advice",
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
    from_number = os.getenv("SPECIALIST_FROM_NUMBER", os.getenv("TELNYX_PHONE_NUMBER"))
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
    client.calls.actions.bridge(
        call_control_id_to_bridge=original_call_id,
        call_control_id_to_bridge_with=specialist_call_id,
        prevent_double_bridge=True,
    )
    session = transfer_sessions[specialist_call_id]
    speak(
        specialist_call_id,
        "i have the context about your duplicate dispute, and i am able to open a dispute for you. what is your name?",
        SPECIALIST_VOICE,
    )
    session["status"] = "specialist_opening"


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
                session = transfer_sessions[call_control_id]
                if session.get("status") != "connecting":
                    return jsonify({"status": "duplicate_call_answered"})
                session["status"] = "bridging"
                bridge_calls(session["original_call_id"], call_control_id)
                return jsonify({"status": "transfer_bridged"})
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
                if session.get("status") == "specialist_opening":
                    session["status"] = "collecting_specialist_name"
                    gather_specialist_name(
                        call_control_id,
                        session.get("billing_issue", "duplicate invoice"),
                    )
                    return jsonify({"status": "specialist_collecting_name"})
                if session.get("status") == "specialist_phone_prompt":
                    session["status"] = "collecting_specialist_phone"
                    gather_specialist_phone_confirmation(call_control_id)
                    return jsonify({"status": "specialist_collecting_phone"})
                if session.get("status") == "specialist_confirmation":
                    session["status"] = "completed"
                    return jsonify({"status": "specialist_completed"})

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
                    "thanks for explaining that. if you would like to open a dispute for that invoice, i can transfer you to a billing specialist who can take a closer look. would you like me to connect you now?",
                    BILLING_VOICE,
                )
                return jsonify({"status": "specialist_offer"})

            choice = str(result.get("route_to_specialist", "")).strip().lower()
            if status == "collecting_transfer_consent" and choice == "yes":
                specialist_call_id = dial_specialist(call_control_id)
                transfer_sessions[specialist_call_id]["billing_issue"] = active_calls[
                    call_control_id
                ].get("billing_issue", "duplicate invoice")
                active_calls[call_control_id]["status"] = "connecting_specialist"
                return jsonify({"status": "specialist_requested", "specialist_call_id": specialist_call_id})
            if status == "collecting_transfer_consent" and choice == "no":
                active_calls[call_control_id]["status"] = "continuing_without_specialist"
                speak(call_control_id, "okay, i can keep helping you here.", BILLING_VOICE)
                return jsonify({"status": "specialist_declined"})

            active_calls[call_control_id]["status"] = "specialist_offer"
            speak(call_control_id, "please say yes if you want a billing specialist, or no if you want to continue here.", BILLING_VOICE)
            return jsonify({"status": "choice_unclear"})

        if event_type == "call.ai_gather.ended" and call_control_id in transfer_sessions:
            result = gather_result(data)
            session = transfer_sessions[call_control_id]
            if session.get("status") == "collecting_specialist_name":
                session["status"] = "specialist_phone_prompt"
                speak(
                    call_control_id,
                    "thanks, can we use the phone number you are calling from?",
                    SPECIALIST_VOICE,
                )
                return jsonify({"status": "specialist_phone_prompt"})
            if session.get("status") == "collecting_specialist_phone":
                session["status"] = "specialist_confirmation"
                speak(
                    call_control_id,
                    "okay, that dispute is open. i have noted your contact information, and a confirmation email is on its way. since this is after hours, a human billing specialist will be able to pick up the case and continue from here when they are available.",
                    SPECIALIST_VOICE,
                )
                return jsonify({"status": "specialist_confirmation"})

        if event_type == "call.hangup":
            active_calls.pop(call_control_id, None)
            transfer_sessions.pop(call_control_id, None)

        return jsonify({"status": "received"})
    except (telnyx.APIStatusError, ValueError) as error:
        app.logger.exception("telnyx command failed")
        return jsonify({"error": str(error)}), 502
    except Exception:
        app.logger.exception("unexpected webhook error")
        return jsonify({"status": "received"})


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        port=int(os.getenv("PORT", "5000")),
    )
