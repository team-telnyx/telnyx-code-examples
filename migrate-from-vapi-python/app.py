#!/usr/bin/env python3
"""Migrate from Vapi — import Vapi voice agents to Telnyx AI Assistants with voice, prompt, and tool configuration mapping."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
VAPI_API_KEY = os.getenv("VAPI_API_KEY", "")
TELNYX_API = "https://api.telnyx.com/v2"
VAPI_API = "https://api.vapi.ai"
telnyx_headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
migration_log = []

VOICE_MAP = {"alloy": "en-US-Neural2-F", "echo": "en-US-Neural2-D",
    "fable": "en-US-Neural2-J", "onyx": "en-US-Neural2-A",
    "nova": "en-US-Neural2-H", "shimmer": "en-US-Neural2-G"}

@app.route("/audit/vapi", methods=["GET"])
def audit_vapi():
    if not VAPI_API_KEY:
        return jsonify({"error": "VAPI_API_KEY not configured. Set it to audit your Vapi agents."}), 400
    try:
        resp = requests.get(f"{VAPI_API}/assistant",
            headers={"Authorization": f"Bearer {VAPI_API_KEY}"}, timeout=15)
        agents = resp.json() if resp.ok else []
        audit = []
        for agent in agents:
            audit.append({"id": agent.get("id"), "name": agent.get("name"),
                "model": agent.get("model", {}).get("model"),
                "voice": agent.get("voice", {}).get("voiceId"),
                "first_message": agent.get("firstMessage"),
                "tools": len(agent.get("model", {}).get("tools", []))})
        migration_log.append({"action": "audit_vapi", "agents": len(audit),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"vapi_agents": audit, "total": len(audit)}), 200
    except Exception as e:
        app.logger.exception("Failed to audit Vapi agents")
        return jsonify({"error": "could not audit Vapi agents"}), 500

@app.route("/migrate/agent", methods=["POST"])
def migrate_agent():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    vapi_config = data.get("vapi_agent", {})
    voice_id = VOICE_MAP.get(vapi_config.get("voice", ""), "en-US-Neural2-F")
    model = vapi_config.get("model", "meta-llama/Llama-3.3-70B-Instruct")
    if "gpt-4" in str(model).lower():
        model = "meta-llama/Llama-3.3-70B-Instruct"
    try:
        resp = requests.post(f"{TELNYX_API}/ai/assistants", headers=telnyx_headers,
            json={"name": vapi_config.get("name", "Migrated Vapi Agent"),
                "instructions": vapi_config.get("systemPrompt", vapi_config.get("instructions", "")),
                "model": model,
                "voice": {"provider": "telnyx", "settings": {"voice_id": voice_id}},
                "greeting": vapi_config.get("firstMessage", "Hello! How can I help?")})
        result = resp.json()
        migration_log.append({"action": "migrate_agent", "vapi_name": vapi_config.get("name"),
            "telnyx_id": result.get("id"),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"telnyx_assistant": result,
            "voice_mapping": {"vapi": vapi_config.get("voice"), "telnyx": voice_id},
            "model_mapping": {"vapi": vapi_config.get("model"), "telnyx": model}}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to migrate Vapi agent")
        return jsonify({"error": "could not migrate agent"}), 500

@app.route("/mapping/voices", methods=["GET"])
def voice_mapping():
    return jsonify({"vapi_to_telnyx": VOICE_MAP,
        "note": "Telnyx also supports ElevenLabs voices via voice.provider='elevenlabs'"}), 200

@app.route("/mapping/models", methods=["GET"])
def model_mapping():
    return jsonify({"recommendations": {
        "gpt-4o": "meta-llama/Llama-3.3-70B-Instruct (or moonshotai/Kimi-K2.6)",
        "gpt-3.5-turbo": "meta-llama/Llama-3.1-8B-Instruct",
        "claude-3": "anthropic/claude-sonnet-4-20250514"},
        "telnyx_models_endpoint": "GET /v2/ai/models"}), 200

@app.route("/migration-log", methods=["GET"])
def get_log():
    return jsonify({"log": migration_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "migrations": len(migration_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
