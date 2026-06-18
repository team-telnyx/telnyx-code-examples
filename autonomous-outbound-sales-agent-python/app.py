#!/usr/bin/env python3
"""Autonomous Outbound Sales Agent — AI-driven lead qualification, objection handling, and meeting booking."""

import os
import json
import time
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
FROM_NUMBER = os.getenv("FROM_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Lead queue and active call tracking
lead_queue = []  # List of {number, name, company, context}
active_calls = {}  # call_control_id -> {lead, conversation, status}
call_results = []  # Completed call dispositions

SYSTEM_PROMPT = """You are an outbound sales development representative for a technology company.
Your goal is to qualify leads and book meetings with interested prospects.

Rules:
- Introduce yourself and state why you are calling within the first 10 seconds.
- Ask qualifying questions: budget, timeline, current solution, decision-making process.
- Handle objections professionally. Common objections: "not interested", "too busy", "send me an email", "we already have a solution."
- If qualified, offer to book a meeting with a solutions engineer.
- If not interested, thank them and end the call gracefully.
- Keep responses under 2 sentences — this is a phone call.
- Never be pushy or aggressive. Be helpful and consultative.
"""


def call_inference(messages, max_tokens=150):
    """Call Telnyx Inference for conversation."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def lookup_number(number):
    """Look up a phone number before calling to verify it's valid."""
    try:
        resp = requests.get(
            f"https://api.telnyx.com/v2/number_lookup/{number}",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("data", {})
    except requests.RequestException:
        pass
    return None


def generate_disposition(conversation):
    """Use inference to generate a structured call disposition."""
    messages = [
        {"role": "system", "content": (
            "Analyze this sales call and return JSON with: "
            "qualified (boolean), interest_level (hot/warm/cold), "
            "objections (list of strings), next_step (string), "
            "meeting_booked (boolean), summary (one paragraph)."
        )},
        {"role": "user", "content": "\n".join(
            f"{m['role']}: {m['content']}" for m in conversation if m["role"] != "system"
        )},
    ]
    return call_inference(messages, max_tokens=300)


def send_confirmation_sms(to_number, message):
    """Send SMS confirmation for booked meetings."""
    try:
        requests.post(
            "https://api.telnyx.com/v2/messages",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": FROM_NUMBER, "to": to_number, "text": message},
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error(f"SMS failed: {e}")


@app.route("/leads", methods=["POST"])
def add_leads():
    """Add leads to the outbound queue."""
    data = request.get_json()
    leads = data.get("leads", [])
    for lead in leads:
        if "number" in lead:
            lead_queue.append(lead)
    return jsonify({"queued": len(leads), "total_in_queue": len(lead_queue)}), 200


@app.route("/campaign/start", methods=["POST"])
def start_campaign():
    """Start calling the lead queue."""
    if not lead_queue:
        return jsonify({"error": "No leads in queue"}), 400
    if not FROM_NUMBER or not CONNECTION_ID:
        return jsonify({"error": "FROM_NUMBER and CONNECTION_ID required"}), 400

    lead = lead_queue.pop(0)

    # Look up the number first
    lookup = lookup_number(lead["number"])
    if lookup and lookup.get("phone_number", {}).get("type") == "landline":
        lead["line_type"] = "landline"

    # Place the outbound call
    try:
        call_resp = requests.post(
            "https://api.telnyx.com/v2/calls",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={
                "to": lead["number"],
                "from": FROM_NUMBER,
                "connection_id": CONNECTION_ID,
            },
            timeout=10,
        )
        call_data = call_resp.json().get("data", {})
        call_control_id = call_data.get("call_control_id")
        if call_control_id:
            active_calls[call_control_id] = {
                "lead": lead,
                "conversation": [{"role": "system", "content": SYSTEM_PROMPT}],
                "status": "dialing",
            }
        return jsonify({"status": "calling", "lead": lead["number"]}), 200
    except requests.RequestException as e:
        lead_queue.insert(0, lead)
        return jsonify({"error": str(e)}), 500


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice_webhook():
    """Handle call events for outbound sales calls."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})

    if not event_type or not call_control_id:
        return jsonify({"error": "Missing event data"}), 400

    call = active_calls.get(call_control_id)

    # --- Call answered: greet the prospect ---
    if event_type == "call.answered" and call:
        lead = call["lead"]
        name = lead.get("name", "")
        greeting = f"Hi{' ' + name if name else ''}, this is Alex from Telnyx. Do you have a quick moment?"
        call["status"] = "active"

        client.calls.actions.speak(
            call_control_id,
            payload=greeting,
            voice="female",
            language_code="en-US",
        )
        call["conversation"].append({"role": "assistant", "content": greeting})
        return jsonify({"status": "greeting"}), 200

    # --- Greeting/response finished: listen ---
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(
            call_control_id,
            input_type="speech",
            end_silence_timeout_secs=2,
            timeout_secs=15,
            language_code="en-US",
        )
        return jsonify({"status": "listening"}), 200

    # --- Speech gathered: process with AI ---
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")

        if not speech:
            client.calls.actions.speak(
                call_control_id,
                payload="I didn't catch that. Could you repeat?",
                voice="female",
                language_code="en-US",
            )
            return jsonify({"status": "reprompting"}), 200

        call["conversation"].append({"role": "user", "content": speech})
        ai_response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": ai_response})

        client.calls.actions.speak(
            call_control_id,
            payload=ai_response,
            voice="female",
            language_code="en-US",
        )
        return jsonify({"status": "responding"}), 200

    # --- Call ended: generate disposition, maybe send SMS ---
    elif event_type == "call.hangup":
        call = active_calls.pop(call_control_id, None)
        if call and len(call["conversation"]) > 2:
            try:
                disposition = generate_disposition(call["conversation"])
                result = {
                    "lead": call["lead"],
                    "disposition": disposition,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                call_results.append(result)

                # If meeting was booked, send SMS confirmation
                try:
                    disp = json.loads(disposition)
                    if disp.get("meeting_booked"):
                        send_confirmation_sms(
                            call["lead"]["number"],
                            "Your meeting with Telnyx is confirmed! Our solutions engineer will reach out shortly with a calendar invite.",
                        )
                except (json.JSONDecodeError, KeyError):
                    pass
            except Exception as e:
                app.logger.error(f"Disposition failed: {e}")
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/results", methods=["GET"])
def get_results():
    """Get all call dispositions."""
    return jsonify({"results": call_results, "remaining_leads": len(lead_queue)}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "active_calls": len(active_calls),
        "leads_queued": len(lead_queue),
        "completed": len(call_results),
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
