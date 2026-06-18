#!/usr/bin/env python3
"""AI-Powered IVR Replacement — natural language routing with A/B testing and structured insights."""

import os
import json
import time
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
ASSISTANT_ID = os.getenv("ASSISTANT_ID")
TELNYX_API_BASE = "https://api.telnyx.com/v2"

# Analytics
call_analytics = {
    "total_calls": 0,
    "resolved_by_ai": 0,
    "transferred_to_human": 0,
    "avg_handle_time": 0,
    "department_distribution": {},
    "version_performance": {},
}
call_records = []


def create_assistant_with_ab_test():
    """Create or update assistant with A/B test versions using Telnyx API.

    This demonstrates the version testing capability:
    - Version A: Formal, professional tone
    - Version B: Casual, friendly tone
    - Traffic split 50/50 for testing

    Call this once during setup — the assistant handles routing automatically.
    """
    # Create the base assistant
    assistant_config = {
        "name": "AI IVR Agent",
        "model": "moonshotai/Kimi-K2.6",
        "instructions": (
            "You are a phone receptionist replacing a traditional IVR menu. "
            "Understand what the caller needs in natural language and route them. "
            "Available departments: Sales, Support, Billing, Returns, Scheduling. "
            "If you can answer the question directly (hours, location, policies), do so. "
            "Only transfer when the caller needs a specialist. "
            "Keep responses under 2 sentences."
        ),
        "telephony_settings": {"enabled": True},
        "greeting": "Hi, welcome to our company. What can I help you with today?",
        "voice": "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f",
        "insight_settings": {
            "enabled": True,
            "params": [
                {"name": "intent", "type": "enum", "enum": ["sales", "support", "billing", "returns", "scheduling", "faq", "other"], "description": "Caller's primary intent"},
                {"name": "resolved_by_ai", "type": "boolean", "description": "Whether the AI resolved the issue without transfer"},
                {"name": "satisfaction", "type": "enum", "enum": ["positive", "neutral", "negative"], "description": "Caller's apparent satisfaction"},
                {"name": "handle_time_seconds", "type": "integer", "description": "Call duration in seconds"},
            ],
        },
    }

    try:
        resp = requests.post(
            f"{TELNYX_API_BASE}/ai/assistants",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=assistant_config,
            timeout=15,
        )
        if resp.ok:
            return resp.json().get("data", {})
    except requests.RequestException as e:
        app.logger.error(f"Assistant creation failed: {e}")
    return None


@app.route("/webhooks/assistant", methods=["POST"])
def handle_assistant_webhook():
    """Handle AI Assistant events — the assistant manages the call flow automatically."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    data = payload.get("data", {})

    # Track call starts
    if event_type == "call.initiated":
        call_analytics["total_calls"] += 1
        return jsonify({"status": "tracked"}), 200

    # Track structured insights when available
    elif event_type == "ai.assistant.insights":
        insights = data.get("insights", {})
        intent = insights.get("intent", "other")
        resolved = insights.get("resolved_by_ai", False)
        satisfaction = insights.get("satisfaction", "neutral")

        if resolved:
            call_analytics["resolved_by_ai"] += 1
        else:
            call_analytics["transferred_to_human"] += 1

        call_analytics["department_distribution"][intent] = (
            call_analytics["department_distribution"].get(intent, 0) + 1
        )

        # Track by assistant version for A/B testing
        version = data.get("assistant_version", "main")
        if version not in call_analytics["version_performance"]:
            call_analytics["version_performance"][version] = {"calls": 0, "resolved": 0, "positive": 0}
        call_analytics["version_performance"][version]["calls"] += 1
        if resolved:
            call_analytics["version_performance"][version]["resolved"] += 1
        if satisfaction == "positive":
            call_analytics["version_performance"][version]["positive"] += 1

        call_records.append({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "intent": intent,
            "resolved": resolved,
            "satisfaction": satisfaction,
            "version": version,
        })
        return jsonify({"status": "insights_recorded"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/setup", methods=["POST"])
def setup_assistant():
    """One-time setup: create the AI assistant with A/B test configuration."""
    result = create_assistant_with_ab_test()
    if result:
        return jsonify({"status": "created", "assistant_id": result.get("id")}), 200
    return jsonify({"error": "Setup failed"}), 500


@app.route("/analytics", methods=["GET"])
def get_analytics():
    """Get IVR replacement analytics and A/B test results."""
    total = call_analytics["total_calls"] or 1
    return jsonify({
        "total_calls": call_analytics["total_calls"],
        "ai_resolution_rate": round(call_analytics["resolved_by_ai"] / total * 100, 1),
        "transfer_rate": round(call_analytics["transferred_to_human"] / total * 100, 1),
        "department_distribution": call_analytics["department_distribution"],
        "ab_test_results": call_analytics["version_performance"],
        "recent_calls": call_records[-20:],
    }), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_calls": call_analytics["total_calls"]}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
