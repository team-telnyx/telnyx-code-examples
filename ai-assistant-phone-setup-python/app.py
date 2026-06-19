#!/usr/bin/env python3
"""AI Assistant Phone Setup — create and configure a managed Telnyx AI Assistant and wire it to a phone number."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
assistants = {}

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

_start_ttl_cleanup(assistants)


@app.route("/assistants", methods=["POST"])
def create_assistant():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/ai/assistants", headers=headers,
            json={"name": data.get("name", "My Assistant"),
                "instructions": data.get("instructions", "You are a helpful assistant. Be friendly and concise."),
                "model": data.get("model", "meta-llama/Llama-3.3-70B-Instruct"),
                "voice": {"provider": data.get("voice_provider", "telnyx"),
                    "settings": {"voice_id": data.get("voice_id", "en-US-Neural2-F"),
                        "speed": data.get("speed", 1.0)}},
                "greeting": data.get("greeting", "Hello! How can I help you today?"),
                "hold_music_url": data.get("hold_music_url")}, timeout=15)
        result = resp.json()
        aid = result.get("id")
        if aid:
            assistants[aid] = result
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create assistant")
        return jsonify({"error": "could not create assistant"}), 500

@app.route("/assistants", methods=["GET"])
def list_assistants():
    try:
        resp = requests.get(f"{API}/ai/assistants", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list assistants")
        return jsonify({"error": "could not list assistants"}), 500

@app.route("/assistants/<assistant_id>", methods=["GET"])
def get_assistant(assistant_id):
    try:
        resp = requests.get(f"{API}/ai/assistants/{assistant_id}", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to get assistant")
        return jsonify({"error": "could not retrieve assistant"}), 500

@app.route("/assistants/<assistant_id>", methods=["PATCH"])
def update_assistant(assistant_id):
    data = request.get_json()
    try:
        resp = requests.patch(f"{API}/ai/assistants/{assistant_id}", headers=headers,
            json=data, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to update assistant")
        return jsonify({"error": "could not update assistant"}), 500

@app.route("/assistants/<assistant_id>/wire", methods=["POST"])
def wire_to_number(assistant_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone_number = data.get("phone_number")
    return jsonify({"assistant_id": assistant_id, "phone_number": phone_number,
        "instructions": "To wire an assistant to a phone number: 1) Create a Call Control Application in the portal, "
            "2) Set the webhook URL to the AI Assistant endpoint, 3) Assign the phone number to the application. "
            "Or use the assistant_id in your webhook handler to route calls to the assistant."}), 200

@app.route("/assistants/<assistant_id>/test", methods=["POST"])
def test_assistant(assistant_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    message = data.get("message", "Hello")
    try:
        resp = requests.post(f"{API}/ai/chat/completions", headers=headers,
            json={"model": "meta-llama/Llama-3.3-70B-Instruct",
                "messages": [{"role": "user", "content": message}], "max_tokens": 200}, timeout=15)
        return jsonify({"response": resp.json().get("choices", [{}])[0].get("message", {}).get("content"),
            "note": "This tests the model directly. The full assistant adds voice, greeting, and tools."}), 200
    except Exception as e:
        app.logger.exception("Failed to test assistant")
        return jsonify({"error": "could not test assistant"}), 500

@app.route("/models", methods=["GET"])
def list_models():
    try:
        resp = requests.get(f"{API}/ai/models", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list models")
        return jsonify({"error": "could not list models"}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "assistants": len(assistants)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
