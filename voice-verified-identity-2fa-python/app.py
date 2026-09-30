#!/usr/bin/env python3
"""Voice-Verified Identity + 2FA — Number Lookup, SMS OTP, and AI-assisted secure transactions."""

import os
import json
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
VERIFY_PROFILE_ID = os.getenv("VERIFY_PROFILE_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Active sessions: call_control_id -> verification state
sessions = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(sessions)


SYSTEM_PROMPT = """You are a secure transaction assistant for a financial institution.
You help verified callers with: balance inquiries, transfers, payment scheduling, account updates.
Rules:
- Never reveal full account numbers or SSN. Use last 4 digits only.
- Confirm the caller has been verified before processing any transaction.
- Read back transaction details and ask for verbal confirmation before executing.
- Keep responses concise — this is a phone call.
- If anything feels suspicious, flag it and offer to transfer to a human agent."""


def number_lookup(phone_number):
    """Look up caller information via Telnyx Number Lookup API."""
    try:
        resp = requests.get(
            f"https://api.telnyx.com/v2/number_lookup/{phone_number}",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("data", {})
    except requests.RequestException:
        pass
    return {}


def send_verification(phone_number):
    """Send OTP via Telnyx Verify API."""
    try:
        resp = requests.post(
            "https://api.telnyx.com/v2/verifications",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={
                "phone_number": phone_number,
                "verify_profile_id": VERIFY_PROFILE_ID,
                "type": "sms",
            },
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("data", {})
    except requests.RequestException as e:
        app.logger.error("Verify send failed: %s", e)
    return None


def check_verification(phone_number, code):
    """Check OTP code via Telnyx Verify API."""
    try:
        resp = requests.post(
            "https://api.telnyx.com/v2/verifications/by_phone_number/{}/actions/verify".format(phone_number, timeout=10),
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"code": code, "verify_profile_id": VERIFY_PROFILE_ID},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("data", {}).get("response_code") == "accepted"
    except requests.RequestException:
        pass
    return False


def call_inference(messages, max_tokens=150):
    """Call Telnyx Inference for conversation."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle voice events for identity-verified transactions."""
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    data = payload.get("data", {})
    p = data.get("payload", {})
    call_control_id = p.get("call_control_id")

    # --- Inbound call: look up number, start verification ---
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        caller = p.get("from", "")
        lookup = number_lookup(caller)
        carrier = lookup.get("carrier", {}).get("name", "Unknown")
        number_type = lookup.get("phone_number", {}).get("type", "unknown")

        sessions[call_control_id] = {
            "caller": caller,
            "carrier": carrier,
            "number_type": number_type,
            "verified": False,
            "verification_sent": False,
            "conversation": [{"role": "system", "content": SYSTEM_PROMPT}],
            "state": "greeting",
        }
        client.calls.actions.answer(call_control_id)
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        session = sessions.get(call_control_id)
        if not session:
            return jsonify({"status": "no_session"}), 200

        # Send OTP for 2FA
        verify_result = send_verification(session["caller"])
        if verify_result:
            session["verification_sent"] = True
            client.calls.actions.speak(
                call_control_id,
                payload="Welcome. For security, I've sent a verification code to your phone. Please enter or say the 6-digit code.",
                voice="female",
                language_code="en-US",
            )
        else:
            client.calls.actions.speak(
                call_control_id,
                payload="Welcome. I wasn't able to send a verification code. Let me transfer you to an agent.",
                voice="female",
                language_code="en-US",
            )
        return jsonify({"status": "verifying"}), 200

    elif event_type == "call.speak.ended":
        session = sessions.get(call_control_id)
        if not session:
            return jsonify({"status": "no_session"}), 200
        # Gather DTMF or speech for verification code
        input_type = "dtmf speech" if not session["verified"] else "speech"
        client.calls.actions.gather(
            call_control_id,
            input_type=input_type,
            end_silence_timeout_secs=3,
            timeout_secs=20,
            language_code="en-US",
            min_digits=6 if not session["verified"] else None,
            max_digits=6 if not session["verified"] else None,
        )
        return jsonify({"status": "gathering"}), 200

    elif event_type == "call.gather.ended":
        session = sessions.get(call_control_id)
        if not session:
            return jsonify({"status": "no_session"}), 200

        digits = p.get("digits", "")
        speech = p.get("speech", {}).get("result", "")
        code = digits or "".join(c for c in speech if c.isdigit())

        # Verification state
        if not session["verified"]:
            if code and len(code) >= 6:
                verified = check_verification(session["caller"], code[:6])
                if verified:
                    session["verified"] = True
                    client.calls.actions.speak(
                        call_control_id,
                        payload="Identity verified. How can I help you today?",
                        voice="female",
                        language_code="en-US",
                    )
                else:
                    client.calls.actions.speak(
                        call_control_id,
                        payload="That code didn't match. Please try again.",
                        voice="female",
                        language_code="en-US",
                    )
            else:
                client.calls.actions.speak(
                    call_control_id,
                    payload="Please enter or say your 6-digit verification code.",
                    voice="female",
                    language_code="en-US",
                )
        else:
            # Verified: handle transaction via AI
            user_input = speech or digits
            if not user_input:
                client.calls.actions.speak(call_control_id, payload="I didn't catch that.", voice="female", language_code="en-US")
                return jsonify({"status": "reprompting"}), 200

            session["conversation"].append({"role": "user", "content": user_input})
            response = call_inference(session["conversation"])
            session["conversation"].append({"role": "assistant", "content": response})
            client.calls.actions.speak(call_control_id, payload=response, voice="female", language_code="en-US")

        return jsonify({"status": "processing"}), 200

    elif event_type == "call.hangup":
        session = sessions.pop(call_control_id, None)
        if session:
            app.logger.info("Session ended: %s, verified: %s", session['caller'], session['verified'])
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_sessions": len(sessions)}), 200


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
