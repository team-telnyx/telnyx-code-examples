#!/usr/bin/env python3
"""Video Room AI Moderator — create video rooms with AI-powered content moderation on chat and participant management."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
rooms = {}

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

_start_ttl_cleanup(rooms)

moderation_log = []

@app.route("/rooms", methods=["POST"])
def create_room():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/rooms", headers=headers,
            json={"unique_name": data.get("name", f"room-{int(time.time())}"),
                "max_participants": data.get("max_participants", 10),
                "enable_recording": data.get("record", False)})
        result = resp.json()
        room_id = result.get("data", {}).get("id")
        if room_id:
            rooms[room_id] = {"id": room_id, "name": data.get("name"),
                "created": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "moderation_rules": data.get("rules", ["no_profanity", "no_harassment", "no_spam"]),
                "participants": [], "warnings": 0}
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create room")
        return jsonify({"error": "could not create room"}), 500

@app.route("/rooms", methods=["GET"])
def list_rooms():
    try:
        resp = requests.get(f"{API}/rooms", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list rooms")
        return jsonify({"error": "could not list rooms"}), 500

@app.route("/rooms/<room_id>/tokens", methods=["POST"])
def create_token(room_id):
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/rooms/{room_id}/actions/generate_join_client_token",
            headers=headers, json={"refresh_token_ttl_secs": 3600,
                "token_ttl_secs": 600}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create join token")
        return jsonify({"error": "could not create join token"}), 500

@app.route("/moderate", methods=["POST"])
def moderate_message():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    room_id = data.get("room_id")
    message = data.get("message", "")
    sender = data.get("sender", "unknown")
    try:
        result = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": "You are a video room moderator. Analyze this chat message for violations: profanity, harassment, spam, threats, sharing personal info. Return JSON: violation (boolean), category (string or null), severity (low/medium/high or null), action (allow/warn/mute/kick)."},
                {"role": "user", "content": message}], "max_tokens": 80, "temperature": 0.1}, timeout=10)
        analysis = json.loads(result.json()["choices"][0]["message"]["content"])
    except Exception:
        analysis = {"violation": False, "action": "allow"}
    entry = {"room_id": room_id, "sender": sender, "message": message[:100],
        "analysis": analysis, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    moderation_log.append(entry)
    if analysis.get("violation"):
        room = rooms.get(room_id, {})
        room["warnings"] = room.get("warnings", 0) + 1
    return jsonify({"moderation": analysis}), 200

@app.route("/moderation-log", methods=["GET"])
def get_log():
    return jsonify({"log": moderation_log[-50:]}), 200

@app.route("/rooms/<room_id>", methods=["DELETE"])
def delete_room(room_id):
    try:
        resp = requests.delete(f"{API}/rooms/{room_id}", headers=headers, timeout=15)
        rooms.pop(room_id, None)
        return jsonify({"status": "deleted"}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to delete room")
        return jsonify({"error": "could not delete room"}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "rooms": len(rooms), "moderation_events": len(moderation_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
