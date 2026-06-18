#!/usr/bin/env python3
"""Video Room AI Meeting Moderator — create video rooms with AI-powered agenda tracking and time management."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
rooms = {}

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/rooms", methods=["POST"])
def create_room():
    data = request.get_json()
    agenda = data.get("agenda", [])
    duration = data.get("duration_minutes", 30)
    try:
        resp = requests.post("https://api.telnyx.com/v2/rooms", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"unique_name": data.get("name", f"meeting-{int(time.time())}"), "max_participants": data.get("max_participants", 10), "enable_recording": True}, timeout=10)
        room_data = resp.json().get("data", {})
        room_id = room_data.get("id")
        if room_id:
            per_item = duration // max(len(agenda), 1)
            rooms[room_id] = {"agenda": [{"topic": item, "minutes": per_item, "status": "pending"} for item in agenda],
                "duration": duration, "start_time": None, "participants": [], "notes": []}
        return jsonify({"room_id": room_id, "room": room_data}), 200
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500

@app.route("/rooms/<room_id>/start", methods=["POST"])
def start_meeting(room_id):
    room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    room["start_time"] = time.time()
    if room["agenda"]:
        room["agenda"][0]["status"] = "active"
    return jsonify({"status": "started", "first_topic": room["agenda"][0]["topic"] if room["agenda"] else None}), 200

@app.route("/rooms/<room_id>/status", methods=["GET"])
def meeting_status(room_id):
    room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    elapsed = int(time.time() - room["start_time"]) // 60 if room["start_time"] else 0
    current = next((a for a in room["agenda"] if a["status"] == "active"), None)
    remaining = room["duration"] - elapsed
    messages = [{"role": "system", "content": "You are a meeting moderator. Based on the agenda status, give a brief status update and time check."},
        {"role": "user", "content": f"Elapsed: {elapsed}min, Remaining: {remaining}min, Current topic: {current}, Full agenda: {json.dumps(room['agenda'])}"}]
    update = call_inference(messages, max_tokens=100)
    return jsonify({"elapsed_minutes": elapsed, "remaining_minutes": remaining, "current_topic": current, "moderator_update": update, "agenda": room["agenda"]}), 200

@app.route("/rooms/<room_id>/next", methods=["POST"])
def next_topic(room_id):
    room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    for i, item in enumerate(room["agenda"]):
        if item["status"] == "active":
            item["status"] = "completed"
            if i + 1 < len(room["agenda"]):
                room["agenda"][i + 1]["status"] = "active"
                return jsonify({"next_topic": room["agenda"][i + 1]["topic"]}), 200
            return jsonify({"status": "all_topics_completed"}), 200
    return jsonify({"status": "no_active_topic"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "rooms": len(rooms)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
