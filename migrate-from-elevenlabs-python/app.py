#!/usr/bin/env python3
"""Migrate from ElevenLabs — import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
TELNYX_API = "https://api.telnyx.com/v2"
telnyx_headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
migration_log = []

VOICE_MAP = {
    "Rachel": {"telnyx": "en-US-Neural2-F", "gender": "female", "style": "professional"},
    "Domi": {"telnyx": "en-US-Neural2-H", "gender": "female", "style": "casual"},
    "Bella": {"telnyx": "en-US-Neural2-G", "gender": "female", "style": "warm"},
    "Antoni": {"telnyx": "en-US-Neural2-D", "gender": "male", "style": "professional"},
    "Elli": {"telnyx": "en-US-Neural2-J", "gender": "female", "style": "young"},
    "Josh": {"telnyx": "en-US-Neural2-A", "gender": "male", "style": "deep"},
    "Arnold": {"telnyx": "en-US-Neural2-I", "gender": "male", "style": "authoritative"},
    "Adam": {"telnyx": "en-US-Neural2-D", "gender": "male", "style": "natural"},
    "Sam": {"telnyx": "en-US-Neural2-A", "gender": "male", "style": "neutral"},
}

@app.route("/audit/elevenlabs", methods=["GET"])
def audit_elevenlabs():
    if not ELEVENLABS_API_KEY:
        return jsonify({"error": "ELEVENLABS_API_KEY not configured"}), 400
    try:
        resp = requests.get("https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": ELEVENLABS_API_KEY})
        voices = resp.json().get("voices", []) if resp.ok else []
        audit = []
        for v in voices:
            telnyx_match = VOICE_MAP.get(v.get("name"), {})
            audit.append({"id": v.get("voice_id"), "name": v.get("name"),
                "category": v.get("category"), "labels": v.get("labels"),
                "telnyx_equivalent": telnyx_match.get("telnyx", "custom mapping needed")})
        return jsonify({"elevenlabs_voices": audit, "total": len(audit),
            "auto_mappable": sum(1 for a in audit if "Neural" in a.get("telnyx_equivalent", ""))}), 200
    except Exception as e:
        app.logger.exception("ElevenLabs audit failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/migrate/voice-config", methods=["POST"])
def migrate_voice():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    el_voice = data.get("elevenlabs_voice_name", "")
    mapping = VOICE_MAP.get(el_voice, {})
    if not mapping:
        return jsonify({"error": f"No auto-mapping for '{el_voice}'. Use /mapping/voices to find similar.",
            "suggestion": "en-US-Neural2-F (default female) or en-US-Neural2-D (default male)"}), 200
    telnyx_config = {"voice": {"provider": "telnyx",
        "settings": {"voice_id": mapping["telnyx"], "speed": data.get("speed", 1.0)}}}
    migration_log.append({"action": "voice_migration", "from": el_voice,
        "to": mapping["telnyx"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
    return jsonify({"elevenlabs": el_voice, "telnyx_config": telnyx_config,
        "cost_comparison": {"elevenlabs": "$0.30/1K chars", "telnyx": "$0.03/1K chars",
            "savings": "~90% cost reduction"}}), 200

@app.route("/mapping/voices", methods=["GET"])
def voice_mapping():
    return jsonify({"mappings": VOICE_MAP,
        "custom_note": "For cloned/custom ElevenLabs voices, Telnyx supports custom voice models via voice.provider='elevenlabs' passthrough or native Telnyx voice cloning."}), 200

@app.route("/cost-comparison", methods=["GET"])
def cost_comparison():
    chars_per_month = int(request.args.get("chars", 1000000))
    el_cost = chars_per_month / 1000 * 0.30
    telnyx_cost = chars_per_month / 1000 * 0.03
    return jsonify({"chars_per_month": chars_per_month,
        "elevenlabs_cost": f"${el_cost:.2f}", "telnyx_cost": f"${telnyx_cost:.2f}",
        "monthly_savings": f"${el_cost - telnyx_cost:.2f}",
        "savings_pct": f"{((el_cost - telnyx_cost) / el_cost * 100):.0f}%"}), 200

@app.route("/test-tts", methods=["POST"])
def test_tts():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    text = data.get("text", "Hello, this is a test of Telnyx text to speech.")
    voice = data.get("voice_id", "en-US-Neural2-F")
    try:
        resp = requests.post(f"{TELNYX_API}/ai/generate/tts", headers=telnyx_headers,
            json={"text": text, "voice": voice, "model": "telnyx/tts-ultra-clara"}, timeout=15)
        return jsonify({"status": "generated", "voice": voice}), resp.status_code
    except Exception as e:
        app.logger.exception("TTS generation failed")
        return jsonify({"note": "TTS endpoint may vary. Use within AI Assistant for voice calls.",
            "error": "transcription failed"}), 200

@app.route("/migration-log", methods=["GET"])
def get_log():
    return jsonify({"log": migration_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "migrations": len(migration_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
