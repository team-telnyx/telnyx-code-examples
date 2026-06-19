#!/usr/bin/env python3
"""Compliance Call Recorder + AI Auditor — auto-record, batch-process with AI, flag violations, create tickets."""

import os
import json
import time
import threading
from urllib.parse import urlparse
import requests
import telnyx
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")
TICKET_WEBHOOK_URL = os.getenv("TICKET_WEBHOOK_URL", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")

# Telnyx Cloud Storage is S3-compatible: boto3 against the regional endpoint, API key
# used as both access and secret key. Docs: https://developers.telnyx.com/docs/cloud-storage/quick-start
s3 = boto3.client(
    "s3", endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY, aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION, config=Config(signature_version="s3v4"),
)


def is_telnyx_url(url: str) -> bool:
    """Only fetch recordings from Telnyx hosts with the API key attached."""
    try:
        parts = urlparse(url or "")
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "telnyx.com" or host.endswith(".telnyx.com"))

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

_start_ttl_cleanup(call_records)

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
        app.logger.error("Ticket creation failed: %s", e)


def store_recording(call_control_id, recording_url):
    """Store call recording in Telnyx Cloud Storage."""
    if not STORAGE_BUCKET or not recording_url or not is_telnyx_url(recording_url):
        return None
    try:
        # Download the recording from Telnyx (API key only sent to a Telnyx host).
        rec_resp = requests.get(
            recording_url,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            timeout=30,
        )
        if not rec_resp.ok:
            return None

        # Upload to Telnyx Cloud Storage (S3-compatible) via boto3.
        filename = f"recordings/{time.strftime('%Y/%m/%d')}/{call_control_id}.mp3"
        s3.put_object(Bucket=STORAGE_BUCKET, Key=filename, Body=rec_resp.content, ContentType="audio/mpeg")
        return filename  # nosemgrep: python.flask.security.audit.directly-returned-format-string -- internal helper return (S3 object key), not an HTTP response.
    except (ClientError, requests.RequestException) as e:
        app.logger.error("Recording storage failed: %s", e)
    return None


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle voice events — auto-record all outbound calls."""
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

    # Track outbound calls
    if event_type == "call.initiated" and p.get("direction") == "outgoing":
        call_records[call_control_id] = {
            "from": p.get("from"),
            "to": p.get("to"),
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
        text = p.get("transcription_data", {}).get("transcript", "")
        if text and call_control_id in call_records:
            call_records[call_control_id]["transcript"].append(text)
        return jsonify({"status": "transcribing"}), 200

    elif event_type == "call.recording.saved":
        recording_url = p.get("recording_urls", {}).get("mp3")
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
                app.logger.error("Audit failed: %s", e)
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
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
