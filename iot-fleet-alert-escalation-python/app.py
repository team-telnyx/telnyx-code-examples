#!/usr/bin/env python3
"""IoT Fleet Alert Escalation — severity-based routing from IoT sensors to SMS, calls, and multi-party conferences."""

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
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
ONCALL_NUMBER = os.getenv("ONCALL_NUMBER")
DISPATCHER_NUMBER = os.getenv("DISPATCHER_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Alert history
alerts = []
active_incidents = {}


def classify_severity(sensor_data):
    """Use inference to classify alert severity and generate briefing."""
    messages = [
        {"role": "system", "content": (
            "You are an IoT alert classifier for a fleet management system. "
            "Analyze the sensor data and return JSON with: "
            "severity (low/medium/critical), category (string — e.g., engine, temperature, location, battery), "
            "briefing (2-sentence human-readable summary for the on-call engineer), "
            "recommended_action (string), time_sensitivity (minutes as integer — how quickly this needs attention)."
        )},
        {"role": "user", "content": json.dumps(sensor_data)},
    ]
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": 200, "temperature": 0.2},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def send_sms(to, text):
    """Send SMS alert."""
    try:
        requests.post(
            "https://api.telnyx.com/v2/messages",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": ALERT_NUMBER, "to": to, "text": text},
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error(f"SMS to {to} failed: {e}")


def place_call(to, briefing_text):
    """Place an outbound call to deliver AI briefing."""
    try:
        resp = requests.post(
            "https://api.telnyx.com/v2/calls",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": to, "from": ALERT_NUMBER, "connection_id": CONNECTION_ID},
            timeout=10,
        )
        call_data = resp.json().get("data", {})
        call_control_id = call_data.get("call_control_id")
        if call_control_id:
            active_incidents[call_control_id] = {"to": to, "briefing": briefing_text, "type": "medium"}
        return call_control_id
    except requests.RequestException as e:
        app.logger.error(f"Call to {to} failed: {e}")
        return None


def create_conference(briefing_text, participants):
    """Create a multi-party conference for critical alerts."""
    conference_calls = []
    for number in participants:
        try:
            resp = requests.post(
                "https://api.telnyx.com/v2/calls",
                headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                json={"to": number, "from": ALERT_NUMBER, "connection_id": CONNECTION_ID},
                timeout=10,
            )
            call_data = resp.json().get("data", {})
            ccid = call_data.get("call_control_id")
            if ccid:
                active_incidents[ccid] = {"to": number, "briefing": briefing_text, "type": "critical"}
                conference_calls.append(ccid)
        except requests.RequestException as e:
            app.logger.error(f"Conference call to {number} failed: {e}")
    return conference_calls


@app.route("/alert", methods=["POST"])
def receive_alert():
    """Receive IoT sensor alert and route based on AI-classified severity."""
    sensor_data = request.get_json()
    if not sensor_data:
        return jsonify({"error": "No sensor data"}), 400

    # Classify severity using inference
    try:
        classification_json = classify_severity(sensor_data)
        classification = json.loads(classification_json)
    except (json.JSONDecodeError, Exception) as e:
        app.logger.error(f"Classification failed: {e}")
        classification = {"severity": "medium", "briefing": f"Unclassified alert from sensor: {json.dumps(sensor_data)[:200]}"}

    severity = classification.get("severity", "medium")
    briefing = classification.get("briefing", "Alert received")
    alert_record = {
        "sensor_data": sensor_data,
        "classification": classification,
        "severity": severity,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "action_taken": "",
    }

    # Route based on severity
    if severity == "low":
        send_sms(ONCALL_NUMBER, f"[LOW] Fleet Alert: {briefing}")
        alert_record["action_taken"] = "SMS sent to on-call"

    elif severity == "medium":
        send_sms(ONCALL_NUMBER, f"[MEDIUM] Fleet Alert: {briefing}")
        place_call(ONCALL_NUMBER, briefing)
        alert_record["action_taken"] = "SMS + call to on-call engineer"

    elif severity == "critical":
        send_sms(ONCALL_NUMBER, f"[CRITICAL] Fleet Alert: {briefing}")
        send_sms(DISPATCHER_NUMBER, f"[CRITICAL] Fleet Alert: {briefing}")
        participants = [ONCALL_NUMBER, DISPATCHER_NUMBER]
        create_conference(briefing, participants)
        alert_record["action_taken"] = "SMS + multi-party conference (on-call + dispatcher)"

    alerts.append(alert_record)
    return jsonify({"severity": severity, "action": alert_record["action_taken"]}), 200


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle call events for alert calls and conferences."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    incident = active_incidents.get(call_control_id)

    if event_type == "call.answered" and incident:
        client.calls.actions.speak(
            call_control_id,
            payload=f"Fleet alert. {incident['briefing']}",
            voice="female",
            language_code="en-US",
        )
        return jsonify({"status": "briefing"}), 200

    elif event_type == "call.speak.ended" and incident:
        if incident["type"] == "critical":
            # After briefing, start conference bridge
            client.calls.actions.gather(
                call_control_id,
                input_type="speech",
                end_silence_timeout_secs=3,
                timeout_secs=60,
                language_code="en-US",
            )
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.hangup":
        active_incidents.pop(call_control_id, None)
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/alerts", methods=["GET"])
def list_alerts():
    """List recent alerts."""
    return jsonify({"alerts": alerts[-50:], "total": len(alerts)}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_incidents": len(active_incidents), "total_alerts": len(alerts)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
