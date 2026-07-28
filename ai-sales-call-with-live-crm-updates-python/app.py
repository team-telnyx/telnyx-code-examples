#!/usr/bin/env python3
"""AI Sales Call with Live CRM Updates — multi-participant call with real-time deal intelligence."""

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
ASSISTANT_ID = os.getenv("ASSISTANT_ID")
CRM_WEBHOOK_URL = os.getenv("CRM_WEBHOOK_URL")
FOLLOW_UP_NUMBER = os.getenv("FOLLOW_UP_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Active calls: call_control_id -> {transcript, prospect_number, ae_number, insights}
active_calls = {}

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

_start_ttl_cleanup(active_calls)



def call_inference(messages, max_tokens=300):
    """Call Telnyx Inference API for deal signal extraction."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def extract_deal_signals(transcript):
    """Use inference to extract structured deal signals from conversation."""
    messages = [
        {"role": "system", "content": (
            "You are a sales intelligence analyst. Extract deal signals from this call transcript. "
            "Return JSON with: budget (string or null), timeline (string or null), "
            "decision_maker (boolean), competitors_mentioned (list of strings), "
            "pain_points (list of strings), next_steps (string or null), "
            "deal_score (1-10 integer), summary (one paragraph)."
        )},
        {"role": "user", "content": transcript},
    ]
    return call_inference(messages, max_tokens=500)


def push_to_crm(deal_data, prospect_number):
    """Push extracted deal signals to CRM via webhook."""
    if not CRM_WEBHOOK_URL:
        app.logger.info("No CRM_WEBHOOK_URL configured, skipping CRM update")
        return
    try:
        requests.post(
            CRM_WEBHOOK_URL,
            json={"prospect_number": prospect_number, "deal_signals": deal_data},
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error("CRM push failed: %s", e)


def send_follow_up_sms(to_number, summary):
    """Send SMS follow-up to prospect after the call."""
    if not FOLLOW_UP_NUMBER:
        return
    try:
        requests.post(
            "https://api.telnyx.com/v2/messages",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": FOLLOW_UP_NUMBER,
                "to": to_number,
                "text": f"Thanks for the call! Here's a summary of what we discussed:\n\n{summary}\n\nReply to this message if you have questions.",
            },
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error("SMS follow-up failed: %s", e)


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice_webhook():
    """Handle voice events for multi-participant AI sales calls."""
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    call_control_id = p.get("call_control_id")

    if not event_type or not call_control_id:
        return jsonify({"error": "Missing event data"}), 400

    # --- Inbound call: AE calls in with prospect on the line ---
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[call_control_id] = {
            "transcript": [],
            "prospect_number": p.get("from"),
            "insights": {},
        }
        client.calls.actions.answer(call_control_id)
        return jsonify({"status": "answering"}), 200

    # --- Call answered: start transcription + AI listening ---
    elif event_type == "call.answered":
        # Start transcription to capture the conversation
        client.calls.actions.start_transcription(
            call_control_id,
            language="en",
        )
        client.calls.actions.speak(
            call_control_id,
            payload="AI assistant connected. I'll listen and take notes. Go ahead with your conversation.",
            voice="female",
            language_code="en-US",
        )
        return jsonify({"status": "transcribing"}), 200

    # --- Transcription data: accumulate transcript ---
    elif event_type == "call.transcription":
        text = p.get("transcription_data", {}).get("transcript", "")
        if text and call_control_id in active_calls:
            active_calls[call_control_id]["transcript"].append(text)
        return jsonify({"status": "transcribing"}), 200

    # --- Call ended: extract signals, push to CRM, send follow-up ---
    elif event_type == "call.hangup":
        call_data = active_calls.pop(call_control_id, None)
        if call_data and call_data["transcript"]:
            full_transcript = " ".join(call_data["transcript"])

            # Extract deal signals via inference
            try:
                signals_json = extract_deal_signals(full_transcript)
                push_to_crm(signals_json, call_data.get("prospect_number", "unknown"))

                # Parse summary for SMS
                try:
                    signals = json.loads(signals_json)
                    summary = signals.get("summary", "Call completed. Our team will follow up shortly.")
                except (json.JSONDecodeError, KeyError):
                    summary = "Thanks for the call. Our team will follow up shortly."

                if call_data.get("prospect_number"):
                    send_follow_up_sms(call_data["prospect_number"], summary)
            except Exception as e:
                app.logger.error("Post-call processing failed: %s", e)

        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_calls": len(active_calls)}), 200


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
