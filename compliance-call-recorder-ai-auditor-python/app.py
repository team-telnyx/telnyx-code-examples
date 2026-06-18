#!/usr/bin/env python3
"""Compliance Call Recorder + AI Auditor — auto-record, batch-process with AI, flag violations, create tickets."""

import os
import json
import time
import threading
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")
TICKET_WEBHOOK_URL = os.getenv("TICKET_WEBHOOK_URL", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Required disclosures that must appear in every outbound sales call
REQUIRED_DISCLOSURES = [
    "This call may be recorded for quality assurance",
    "Company name identification",
    "Purpose of the call stated within first 30 seconds",
    "Opt-out mechanism offered if requested",
    "No misleading claims about pricing or capabilities",
]

# Call records and audit results
call_records = {}  # call_control_id -> record
audit_results = []
violations = []


def call_inference(messages, max_tokens=500):
    """Call Telnyx Inference for compliance analysis."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.1},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def audit_transcript(transcript, rep_name="Unknown"):
    """Audit a call transcript for compliance violations."""
    disclosure_list = "\n".join(f"- {d}" for d in REQUIRED_DISCLOSURES)
    messages = [
        {"role": "system", "content": (
            "You are a compliance auditor for outbound sales calls. "
            "Analyze the transcript for regulatory compliance. "
            f"Required disclosures:\n{disclosure_list}\n\n"
            "Return JSON with: "
            "compliant (boolean), risk_score (1-10, 10=highest risk), "
            "disclosures_made (list of strings — which required disclosures were made), "
            "disclosures_missing (list of strings — which were not made), "
            "violations (list of {type, description, severity, timestamp_approx}), "
            "misleading_claims (list of strings), "
            "recommendation (string — corrective action if non-compliant)."
        )},
        {"role": "user", "content": f"Representative: {rep_name}\n\nTranscript:\n{transcript}"},
    ]
    return call_inference(messages, max_tokens=800)


def create_ticket(violation_data):
    """Create a ticket for compliance violations via webhook."""
    if not TICKET_WEBHOOK_URL:
        app.logger.info("No TICKET_WEBHOOK_URL, skipping ticket creation")
        return
    try:
        requests.post(
            TICKET_WEBHOOK_URL,
            json=violation_data,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error(f"Ticket creation failed: {e}")


def store_recording(call_control_id, recording_url):
    """Store call recording in Telnyx Cloud Storage."""
    if not STORAGE_BUCKET or not recording_url:
        return None
    try:
        # Download recording
        rec_resp = requests.get(
            recording_url,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            timeout=30,
        )
        if not rec_resp.ok:
            return None

        # Upload to Telnyx Storage
        filename = f"recordings/{time.strftime('%Y/%m/%d')}/{call_control_id}.mp3"
        upload_resp = requests.put(
            f"https://api.telnyx.com/v2/storage/buckets/{STORAGE_BUCKET}/{filename}",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "audio/mpeg"},
            data=rec_resp.content,
            timeout=30,
        )
        if upload_resp.ok:
            return filename
    except requests.RequestException as e:
        app.logger.error(f"Recording storage failed: {e}")
    return None


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle voice events — auto-record all outbound calls."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})

    # Track outbound calls
    if event_type == "call.initiated" and data.get("direction") == "outgoing":
        call_records[call_control_id] = {
            "from": data.get("from"),
            "to": data.get("to"),
            "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "transcript": [],
        }
        return jsonify({"status": "tracking"}), 200

    elif event_type == "call.answered":
        if call_control_id in call_records:
            # Start recording and transcription
            client.calls.actions.record_start(call_control_id, format="mp3", channels="dual")
            client.calls.actions.transcription_start(call_control_id, language="en")
        return jsonify({"status": "recording"}), 200

    elif event_type == "call.transcription":
        text = data.get("transcription_data", {}).get("transcript", "")
        if text and call_control_id in call_records:
            call_records[call_control_id]["transcript"].append(text)
        return jsonify({"status": "transcribing"}), 200

    elif event_type == "call.recording.saved":
        recording_url = data.get("recording_urls", {}).get("mp3")
        if call_control_id in call_records and recording_url:
            call_records[call_control_id]["recording_url"] = recording_url
            stored = store_recording(call_control_id, recording_url)
            if stored:
                call_records[call_control_id]["storage_path"] = stored
        return jsonify({"status": "recording_saved"}), 200

    elif event_type == "call.hangup":
        record = call_records.pop(call_control_id, None)
        if record and record.get("transcript"):
            full_transcript = " ".join(record["transcript"])
            try:
                audit_json = audit_transcript(full_transcript, record.get("from", "Unknown"))
                audit = json.loads(audit_json)
                result = {
                    "call_from": record.get("from"),
                    "call_to": record.get("to"),
                    "timestamp": record.get("start_time"),
                    "compliant": audit.get("compliant", True),
                    "risk_score": audit.get("risk_score", 0),
                    "violations": audit.get("violations", []),
                    "storage_path": record.get("storage_path"),
                }
                audit_results.append(result)

                if not audit.get("compliant", True):
                    violations.append(result)
                    create_ticket({
                        "title": f"Compliance violation: {record.get('from')} → {record.get('to')}",
                        "severity": "high" if audit.get("risk_score", 0) >= 7 else "medium",
                        "details": audit,
                    })
            except (json.JSONDecodeError, Exception) as e:
                app.logger.error(f"Audit failed: {e}")
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/audit/results", methods=["GET"])
def get_audit_results():
    """Get audit results with compliance metrics."""
    total = len(audit_results) or 1
    compliant = sum(1 for r in audit_results if r.get("compliant"))
    return jsonify({
        "total_audited": len(audit_results),
        "compliance_rate": round(compliant / total * 100, 1),
        "violations": len(violations),
        "avg_risk_score": round(sum(r.get("risk_score", 0) for r in audit_results) / total, 1),
        "recent_results": audit_results[-20:],
        "recent_violations": violations[-10:],
    }), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "calls_tracking": len(call_records), "total_audited": len(audit_results)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
