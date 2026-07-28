#!/usr/bin/env python3
"""AI Podcast Post-Producer — record a podcast over a conference call, then AI generates show notes, timestamps, highlights, and social media clips."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
PODCAST_NUMBER = os.getenv("PODCAST_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
episodes = []

def call_inference(messages, max_tokens=800):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4}, timeout=25)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    event_type = payload.get("data", {}).get("event_type")
    data = payload.get("data", {})
    p = data.get("payload", {})
    ccid = p.get("call_control_id")
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.start_recording(ccid, format="mp3", channels="dual")
        client.calls.actions.speak(ccid, payload="Podcast recording started. Speak naturally. The recording will be processed when the call ends.", voice="female", language_code="en-US")
        return jsonify({"status": "recording"}), 200
    elif event_type == "call.recording.saved":
        recording = {"url": p.get("recording_urls", {}).get("mp3"), "duration": p.get("duration_secs"),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        episodes.append({"recording": recording, "status": "recorded"})
        return jsonify({"status": "saved"}), 200
    elif event_type == "call.hangup":
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/produce", methods=["POST"])
def produce_episode():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    transcript = data.get("transcript", "")
    title = data.get("title", "Untitled Episode")
    if not transcript: return jsonify({"error": "transcript required"}), 400
    try:
        result = call_inference([{"role": "system", "content": """You are a podcast post-production AI. From this transcript, generate:
1. episode_title: catchy title (or refine the given one)
2. description: 2-3 paragraph episode description
3. show_notes: bullet points of key topics
4. timestamps: list of {time_estimate, topic} marking segment changes
5. highlights: top 3 quotable moments (exact quotes)
6. social_clips: 3 social media post suggestions (Twitter-length)
7. tags: list of relevant tags
8. guest_bios: if guests are identifiable
Return as JSON."""},
            {"role": "user", "content": f"Title: {title}\n\nTranscript:\n{transcript[:4000]}"}])
        production = json.loads(result)
        production["produced_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        return jsonify(production), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception as e:
        app.logger.exception("Episode production failed")
        return jsonify({"error": "episode production failed"}), 500

@app.route("/episodes", methods=["GET"])
def list_episodes():
    return jsonify({"episodes": episodes[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "episodes": len(episodes)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
