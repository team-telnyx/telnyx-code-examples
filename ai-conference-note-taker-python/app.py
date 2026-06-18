#!/usr/bin/env python3
"""AI Conference Note-Taker — joins calls, transcribes, extracts action items, sends SMS summaries."""

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
NOTETAKER_NUMBER = os.getenv("NOTETAKER_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Active meetings: call_control_id -> meeting data
meetings = {}
completed_meetings = []


def call_inference(messages, max_tokens=500):
    """Call Telnyx Inference API."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def generate_meeting_notes(transcript, participants):
    """Generate structured meeting notes from transcript."""
    messages = [
        {"role": "system", "content": (
            "You are a meeting note-taker. Generate structured notes from this call transcript. "
            "Return JSON with: title (string), summary (2-3 sentences), "
            "key_decisions (list of strings), action_items (list of {owner, task, deadline}), "
            "open_questions (list of strings), next_meeting (string or null)."
        )},
        {"role": "user", "content": f"Participants: {', '.join(participants)}\n\nTranscript:\n{transcript}"},
    ]
    return call_inference(messages, max_tokens=800)


def send_sms(to, text):
    """Send SMS via Telnyx."""
    try:
        requests.post(
            "https://api.telnyx.com/v2/messages",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": NOTETAKER_NUMBER, "to": to, "text": text},
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error(f"SMS failed to {to}: {e}")


@app.route("/join", methods=["POST"])
def join_meeting():
    """Join a conference call. POST {dial_number, participants: [{name, number}]}"""
    data = request.get_json()
    dial_number = data.get("dial_number")
    participants = data.get("participants", [])

    if not dial_number:
        return jsonify({"error": "dial_number required"}), 400

    try:
        call_resp = requests.post(
            "https://api.telnyx.com/v2/calls",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": dial_number, "from": NOTETAKER_NUMBER, "connection_id": CONNECTION_ID},
            timeout=10,
        )
        call_data = call_resp.json().get("data", {})
        call_control_id = call_data.get("call_control_id")

        if call_control_id:
            meetings[call_control_id] = {
                "dial_number": dial_number,
                "participants": participants,
                "transcript": [],
                "start_time": time.time(),
                "status": "joining",
            }
            return jsonify({"status": "joining", "call_control_id": call_control_id}), 200
        return jsonify({"error": "No call_control_id returned"}), 500
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle call events for meeting note-taking."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})

    meeting = meetings.get(call_control_id)

    if event_type == "call.answered" and meeting:
        meeting["status"] = "recording"
        # Start real-time transcription
        client.calls.actions.transcription_start(call_control_id, language="en")
        return jsonify({"status": "transcribing"}), 200

    elif event_type == "call.transcription" and meeting:
        text = data.get("transcription_data", {}).get("transcript", "")
        if text:
            meeting["transcript"].append({
                "text": text,
                "timestamp": time.time() - meeting["start_time"],
            })
        return jsonify({"status": "recording"}), 200

    elif event_type == "call.hangup":
        meeting = meetings.pop(call_control_id, None)
        if meeting and meeting["transcript"]:
            full_transcript = "\n".join(
                f"[{int(t['timestamp']//60)}:{int(t['timestamp']%60):02d}] {t['text']}"
                for t in meeting["transcript"]
            )
            participant_names = [p.get("name", p.get("number", "Unknown")) for p in meeting["participants"]]

            try:
                notes_json = generate_meeting_notes(full_transcript, participant_names)
                duration = int(time.time() - meeting["start_time"])

                completed = {
                    "notes": notes_json,
                    "duration_seconds": duration,
                    "participants": meeting["participants"],
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                completed_meetings.append(completed)

                # Send SMS summary to all participants
                try:
                    notes = json.loads(notes_json)
                    summary = f"Meeting Notes: {notes.get('title', 'Meeting')}\n\n"
                    summary += f"{notes.get('summary', '')}\n\n"
                    if notes.get("action_items"):
                        summary += "Action Items:\n"
                        for item in notes["action_items"][:5]:
                            owner = item.get("owner", "TBD")
                            task = item.get("task", "")
                            summary += f"• {owner}: {task}\n"
                except (json.JSONDecodeError, KeyError):
                    summary = f"Meeting ended ({duration//60}m). Full notes available via API."

                for participant in meeting["participants"]:
                    number = participant.get("number")
                    if number:
                        send_sms(number, summary)

            except Exception as e:
                app.logger.error(f"Note generation failed: {e}")

        return jsonify({"status": "meeting_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/meetings", methods=["GET"])
def list_meetings():
    """List active and completed meetings."""
    return jsonify({
        "active": {k: {"status": v["status"], "duration": int(time.time() - v["start_time"])} for k, v in meetings.items()},
        "completed": completed_meetings[-20:],
    }), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_meetings": len(meetings), "completed": len(completed_meetings)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
