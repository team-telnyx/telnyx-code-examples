#!/usr/bin/env python3
"""Simple AI billing warm transfer demo using Telnyx Call Control."""

import os

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

MODEL = os.getenv("TELNYX_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
BILLING_VOICE = os.getenv(
    "BILLING_VOICE", "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02"
)
SPECIALIST_VOICE = os.getenv(
    "SPECIALIST_VOICE", "Telnyx.Ultra.0d42f0f6-c019-4082-b250-1c16133d1c82"
)

BILLING_AGENT_PROMPT = """
You are a billing support agent for Cedar Harbor Bank.
Ask what the caller needs help with. If they describe a billing issue, ask if
they want to be connected to a billing specialist. Return the caller's issue
and whether they agreed to the transfer.
""".strip()

SPECIALIST_AGENT_PROMPT = """
You are the billing specialist. You are joining after a warm transfer.
Start by briefly acknowledging the billing issue from the first agent, then
continue helping the caller with the dispute.
""".strip()

active_calls = {}
transfer_sessions = {}


def gather_billing_issue(call_control_id: str) -> None:
    client.calls.actions.gather_using_ai(
        call_control_id=call_control_id,
        assistant={"instructions": BILLING_AGENT_PROMPT, "model": MODEL},
        parameters={
            "type": "object",
            "properties": {
                "billing_issue": {
                    "type": "string",
                    "description": "the caller's billing issue",
                },
                "transfer_approved": {
                    "type": "boolean",
                    "description": "true if the caller agreed to speak with a billing specialist",
                },
            },
            "required": ["billing_issue", "transfer_approved"],
        },
        greeting="Hi, this is Cedar Harbor Bank billing support. What can I help you with today?",
        voice=BILLING_VOICE,
        user_response_timeout_ms=15000,
    )


def start_specialist_transfer(original_call_id: str, billing_issue: str) -> str:
    specialist_number = os.getenv("HUMAN_TRANSFER_NUMBER")
    from_number = os.getenv("SPECIALIST_FROM_NUMBER") or os.getenv("TELNYX_PHONE_NUMBER")
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
        "billing_issue": billing_issue,
    }
    return specialist_call_id


def bridge_to_specialist(specialist_call_id: str) -> None:
    session = transfer_sessions[specialist_call_id]
    client.calls.actions.bridge(
        call_control_id_to_bridge=session["original_call_id"],
        call_control_id_to_bridge_with=specialist_call_id,
        prevent_double_bridge=True,
    )
    client.calls.actions.gather_using_ai(
        call_control_id=specialist_call_id,
        assistant={"instructions": SPECIALIST_AGENT_PROMPT, "model": MODEL},
        parameters={
            "type": "object",
            "properties": {
                "specialist_notes": {
                    "type": "string",
                    "description": "short notes from the specialist conversation",
                }
            },
        },
        greeting=(
            "I have the context from billing support: "
            f"{session['billing_issue']}. I can help from here."
        ),
        voice=SPECIALIST_VOICE,
        user_response_timeout_ms=15000,
    )


def gather_result(data: dict) -> dict:
    event = data.get("data") or {}
    payload = event.get("payload", event)
    result = payload.get("result", {})
    return result if isinstance(result, dict) else {}


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.post("/webhooks/voice")
def voice_webhook():
    data = request.get_json(silent=True) or {}
    event = data.get("data") or {}
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
                bridge_to_specialist(call_control_id)
                return jsonify({"status": "transfer_bridged"})

            if call_control_id in active_calls:
                active_calls[call_control_id]["status"] = "collecting_billing_issue"
                gather_billing_issue(call_control_id)
            return jsonify({"status": "received"})

        if event_type == "call.ai_gather.ended" and call_control_id in active_calls:
            result = gather_result(data)
            billing_issue = result.get("billing_issue", "billing issue")
            if result.get("transfer_approved") is True:
                specialist_call_id = start_specialist_transfer(call_control_id, billing_issue)
                active_calls[call_control_id]["status"] = "transferring"
                return jsonify(
                    {
                        "status": "specialist_transfer_started",
                        "specialist_call_id": specialist_call_id,
                    }
                )

            active_calls[call_control_id]["status"] = "completed_without_transfer"
            return jsonify({"status": "transfer_declined"})

        if event_type == "call.hangup":
            active_calls.pop(call_control_id, None)
            transfer_sessions.pop(call_control_id, None)

        return jsonify({"status": "received"})
    except (telnyx.APIStatusError, ValueError) as error:
        app.logger.exception("telnyx command failed")
        return jsonify({"error": str(error)}), 502


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        port=int(os.getenv("PORT", "5000")),
    )
